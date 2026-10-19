package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/Downvid/downvid/app/internal/deps"
)

// 复用测试二进制扮演边车，三种桌面平台都能验证真实 argv，无需 shell 或外部工具。
func TestMain(m *testing.M) {
	if os.Getenv("DOWNVID_TEST_DEPS_SIDECAR") == "1" && len(os.Args) > 1 && os.Args[1] == "detect" {
		paths := map[string]string{}
		for i := 2; i+1 < len(os.Args); i++ {
			if os.Args[i] == "--manual" {
				kind, path, ok := strings.Cut(os.Args[i+1], "=")
				if ok {
					paths[kind] = path
				}
				i++
			}
		}
		var results []deps.Status
		for _, kind := range deps.AllKinds {
			path, source := paths[kind], "manual"
			if path == "" {
				path, source = filepath.Join("system-tools", kind), "system"
			}
			results = append(results, deps.Status{Kind: kind, Found: true, Path: path, Source: source})
		}
		if err := json.NewEncoder(os.Stdout).Encode(deps.Snapshot{Results: results}); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func newDepsTestApp(t *testing.T) *App {
	t.Helper()
	t.Setenv("DOWNVID_TEST_DEPS_SIDECAR", "1")
	sidecar, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	app := newTestApp(t)
	app.deps = deps.NewManager(sidecar, filepath.Join(app.dataDir, "runtime", "bin"))
	return app
}

func setTestDepPaths(t *testing.T, app *App, paths map[string]string) {
	t.Helper()
	patch, err := json.Marshal(map[string]any{"depPaths": paths})
	if err != nil {
		t.Fatal(err)
	}
	if result := app.UpdateSettings(string(patch)); !result.OK {
		t.Fatal(result.Error)
	}
}

func TestManualDependencyPathsReachBindings(t *testing.T) {
	app := newDepsTestApp(t)
	paths := map[string]string{}
	for _, kind := range deps.AllKinds {
		paths[kind] = filepath.Join(t.TempDir(), "custom tools=1", kind)
	}
	setTestDepPaths(t, app, paths)

	// 两个公开探测入口必须与解析、下载使用同一份配置。
	statuses := app.DetectDeps(false)
	if len(statuses) != len(paths) {
		t.Fatalf("依赖数量不符：%+v", statuses)
	}
	for _, d := range statuses {
		if !d.Found || d.Source != "manual" || d.Path != paths[d.Kind] {
			t.Fatalf("设置页忽略了手动路径：%+v", d)
		}
	}
	legacy := app.DetectDependencies()
	if len(legacy) != len(paths) {
		t.Fatalf("兼容探测入口依赖数量不符：%+v", legacy)
	}
	for _, d := range legacy {
		if !d.Found || d.Source != "manual" || d.Path != paths[d.Kind] {
			t.Fatalf("兼容探测入口忽略了手动路径：%+v", d)
		}
	}
	if got := app.ResolveYtdlp(); got != paths["yt-dlp"] {
		t.Fatalf("解析、下载应使用手动 yt-dlp，实际 %q", got)
	}
	args := app.buildArgs(DownloadRequest{URL: "https://example.com/video", DownloadMode: "video"})
	for flag, want := range map[string]string{
		"--ffmpeg-location": filepath.Dir(paths["ffmpeg"]),
		"--downloader":      "http:" + paths["aria2"],
	} {
		i := slices.Index(args, flag)
		if i < 0 || i+1 >= len(args) || args[i+1] != want {
			t.Fatalf("下载参数 %s 未使用手动路径 %q：%v", flag, want, args)
		}
	}
}

func TestManualDependencyPathsChangeAndReset(t *testing.T) {
	app := newDepsTestApp(t)
	first := filepath.Join(t.TempDir(), "first", "yt-dlp")
	second := filepath.Join(t.TempDir(), "second", "yt-dlp")
	for _, path := range []string{first, second, ""} {
		setTestDepPaths(t, app, map[string]string{"yt-dlp": path})
		// 先预热设置页使用的缓存，再确认运行时不会读到另一份旧缓存。
		if summary := app.DepsSummary(); summary["error"] != nil {
			t.Fatal(summary["error"])
		}
		want := path
		if want == "" {
			want = filepath.Join("system-tools", "yt-dlp")
		}
		if got := app.ResolveYtdlp(); got != want {
			t.Fatalf("修改/清除手动路径后应为 %q，实际 %q", want, got)
		}
	}
	setTestDepPaths(t, app, map[string]string{"yt-dlp": first})
	if got := app.ResolveYtdlp(); got != first {
		t.Fatalf("重置前应为 %q，实际 %q", first, got)
	}
	if result := app.ResetSettings(); !result.OK {
		t.Fatal(result.Error)
	}
	if got := app.ResolveYtdlp(); got != filepath.Join("system-tools", "yt-dlp") {
		t.Fatalf("恢复默认设置后仍使用手动路径：%q", got)
	}

	// 不同应用实例不能共用包级缓存，否则会使用别人的手动路径。
	other := newDepsTestApp(t)
	setTestDepPaths(t, other, map[string]string{"yt-dlp": second})
	if got := other.ResolveYtdlp(); got != second {
		t.Fatalf("应用实例之间串用了依赖缓存：%q", got)
	}
	if got := app.ResolveYtdlp(); got != filepath.Join("system-tools", "yt-dlp") {
		t.Fatalf("另一实例改设置不应影响当前实例：%q", got)
	}
}

func TestDependencyDetectionReportsSettingsError(t *testing.T) {
	app := newDepsTestApp(t)
	if err := os.WriteFile(app.GetSettingsPath(), []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	got := app.DetectDeps(false)
	if len(got) != 1 || got[0].Found || !strings.Contains(got[0].Reason, "读取运行依赖设置失败") {
		t.Fatalf("设置不可读时不应静默忽略手动路径：%+v", got)
	}
}
