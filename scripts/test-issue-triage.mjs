#!/usr/bin/env node
/**
 * Issue 自动关闭（triage）逻辑回归。
 *
 * 用**仓库里真实出现过的 Issue 正文**做用例，而不是编造的样例——
 * 这套逻辑的价值就在「能不能把 #58/#59 关掉、又不会误关 #50/#52/#57」，
 * 编造的样例测不出这一点。
 *
 * 最危险的是**误关**：把一条真实报告关掉，贡献者会觉得没人管，
 * 而噪音只是多看两眼。所以每条「不该关」的用例都必须钉死。
 *
 * 用法：node scripts/test-issue-triage.mjs
 */

import { createSuite } from './lib/harness.mjs'
import { loader } from './lib/load-source.mjs'

const suite = createSuite('Issue 自动关闭分类')
const load = loader()
const { classifyIssue, commentFor } = load('scripts/lib/issue-triage.ts')
const { safeIssueReport, PARSE_MESSAGES } = load('shared/parse-error.ts')

// ===== 真实 Issue 正文（取自仓库 #50 / #52 / #57 / #58 / #60 / #78 / #79）=====

/** #58：应用自动生成，用户一路回车，正文里没有任何输入 */
const ISSUE_58 = `## 问题描述

该视频需要登录或访问权限，请检查 Cookies 设置

## 脱敏诊断

错误类别：authentication
该视频需要登录或访问权限，请检查 Cookies 设置
ytdlp：2026.10.10.233141
runtime：node@24.21.0

## 复现步骤

请补充不含个人信息的复现步骤。`

/** #50：带原始报错的真实报告（page-reload 回归）——绝不能关 */
const ISSUE_50 = `## 问题描述

解析失败：ERROR: [youtube] 8fqV8NqmIUk: The page needs to be reloaded.

## 错误详情

\`\`\`
Error invoking remote method 'ytdlp:parse': Error: ERROR: [youtube] 8fqV8NqmIUk: The page needs to be reloaded.
\`\`\`

## 环境信息

- 操作系统: Win32
- 用户代理: Mozilla/5.0 (Windows NT 10.0; Win64; x64) downvid/1.3.2`

/** #52：用户填了链接，报「不支持该网站」——含链接，不能关 */
const ISSUE_52 = `## 问题描述

解析失败：请输入有效的链接

## 错误详情

\`\`\`
Error invoking remote method 'ytdlp:parse': Error: ERROR: Unsupported URL: https://channels.weixin.qq.com/finder-preview/pages/sph?id=AI4uMLmhMy
\`\`\`

## 环境信息

- 操作系统: Win32`

/** #57：authentication 但**带着**原始报错——不能关 */
const ISSUE_57 = `## 问题描述

解析失败：ERROR: [youtube] 8atq1TtMPZM: Sign in to confirm you're not a bot.

## 错误详情

\`\`\`
Error invoking remote method 'ytdlp:parse': Error: ERROR: [youtube] 8atq1TtMPZM: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.
\`\`\`

## 环境信息

- 操作系统: Win32`

/** #60：手工从模板提交，但每一项都填了占位垃圾——真实正文 */
const ISSUE_60 = `### Platform

macOS (Apple Silicon)

### DownVid Version

dadas

### Issue Category

Other

### Issue Description

sdasdas

### Steps to Reproduce

dsadasd

### Video URL (if applicable)

_No response_

### Expected Behavior

_No response_

### Screenshots/Screen Recording

_No response_

### Error Logs

\`\`\`shell

\`\`\`

### Before Submitting

- [x] I have searched existing issues and found no duplicates
- [x] I am using the latest version
- [x] I have read the README and FAQ
`

/** #78：应用自动生成，标题和正文都原样未动——真实的空报告 */
const ISSUE_78_TITLE = '[Bug] 无法解析该链接'
const ISSUE_78 = `## 问题描述

无法解析该链接

## 脱敏诊断

错误类别：unknown
无法解析该链接

## 复现步骤

请补充不含个人信息的复现步骤。`

/**
 * #79：同样是应用生成的模板，但用户在复现步骤后补了一句话，并把链接追加在**标题**末尾。
 * 这条被误关了：正文那句话只有 11 个字，当时按「剥完模板后不足 24 个字符」判成空报告；
 * 链接在标题里，而分类只看正文。关评还告诉用户「正文里没有包含任何你的输入」。
 */
const ISSUE_79_TITLE = '[Bug] 无法解析该链接https://v.douyin.com/QN150vJr9TM'
const ISSUE_79 = `${ISSUE_78}
抖音视频好像都无法下载`

// ===== 空报告：必须关 =====

suite.case('应用自动生成的空报告（#58）应被关闭', async (t) => {
  const v = classifyIssue(ISSUE_58)
  t.equal(v.close, true, '正文里没有任何用户输入，无法据此定位问题')
  // 关键：关评内容要**对用户有用**。这是 authentication，所以给「怎么配 Cookie」，
  // 而不是干巴巴一句「你什么都没写」——他的真实问题就是没配 Cookie。
  t.equal(v.reason, 'self-service', '已知类别优先走自助类，回复才对用户有用')
  t.equal(v.kind, 'authentication', '应识别出错误类别')
  t.ok(commentFor(v).includes('Cookies'), '关评应给出具体的解决步骤')
})

suite.case('同样的空报告换个用户提交也要关（#59）', async (t) => {
  // 实测同一个文案连开两条，说明这不是偶发
  const v = classifyIssue(ISSUE_58)
  t.equal(v.close, true)
})

suite.case('空报告只多打几个换行 / 空格仍然算空', async (t) => {
  const v = classifyIssue(ISSUE_58 + '\n\n\n   \n')
  t.equal(v.close, true, '用户没有实质补充，不应因为多了空白就放行')
})

suite.case('标题和正文都没动的空报告（#78）应被关闭', async (t) => {
  // 标题是应用预填的 `[Bug] <错误文案>`，一并传进来不能算成「用户写了东西」
  const v = classifyIssue(ISSUE_78, ISSUE_78_TITLE)
  t.equal(v.close, true)
  t.equal(v.reason, 'template-only')
})

suite.case('应用原样生成的报告一律算空报告（任意类别 × 诊断行 × 换行符）', async (t) => {
  // `诊断：` 行也是应用自己写的（parseDiagnostic 追加），此前没被剥掉：两行同时出现时
  // 剩下 27 个字符，越过了「不足 24 个字符」的门槛。YouTube 报错常常同时带
  // JS 验证失败与 SABR，这类空报告于是一直留在 open 里
  const diagnostics = {
    无诊断: '',
    JS: '\nERROR: n challenge solving failed',
    SABR: '\nWARNING: YouTube is forcing SABR streaming',
    两行: '\nERROR: n challenge solving failed\nWARNING: YouTube is forcing SABR streaming',
  }
  for (const kind of Object.keys(PARSE_MESSAGES)) {
    for (const [name, extra] of Object.entries(diagnostics)) {
      const report = safeIssueReport(PARSE_MESSAGES[kind], `[[parse-error:${kind}]]\nytdlp：2026.10.10${extra}`)
      // 网页表单提交上来的正文是 CRLF 换行
      for (const body of [report.body, report.body.replaceAll('\n', '\r\n')]) {
        t.equal(classifyIssue(body, report.title).close, true, `${kind} / ${name}：应用原样生成的报告应关闭`)
      }
    }
  }
})

suite.case('手工提交但填占位垃圾的模板 Issue（#60）应被关闭', async (t) => {
  // 这条不是应用自动生成的，是用户从模板手工提交、把必填项填成 dsadsa/dadas。
  // 模板校验只要求「非空」，所以照样能开出来，正文里没有任何可用信息。
  const v = classifyIssue(ISSUE_60)
  t.equal(v.close, true, '全是占位文字，无法据此定位问题')
  t.equal(v.reason, 'insufficient-info', '应归类为「信息不足」而不是「只有模板」')
  t.ok(commentFor(v).includes('链接'), '关评要告诉用户该补什么信息')
  // 真实标题同样是占位文字，一并传进来也不能放行
  t.equal(classifyIssue(ISSUE_60, '[Bug] dsadsa').close, true, '占位标题不算有效内容')
  // 反过来，标题本身描述了具体现象（取自 #49 的真实标题）就是有效报告
  t.equal(classifyIssue(ISSUE_60, '[Bug] B站右上角水印无法去除').close, false, '标题描述了具体现象')
})

suite.case('下拉框选项（Other）不算用户内容', async (t) => {
  // `Other` 是 Issue Category 的选项值，单独出现时不能算「用户写了东西」
  const v = classifyIssue('### Issue Category\n\nOther\n\n### Issue Description\n\nx\n')
  t.equal(v.close, true)
})

suite.case('填写完整的模板 Issue 不能关', async (t) => {
  const v = classifyIssue(`### Platform

Windows 11

### DownVid Version

1.3.4

### Issue Category

下载失败/中断

### Issue Description

下载 B 站视频到 99% 之后报错，重试三次都一样，换成 720P 可以成功。

### Steps to Reproduce

1. 粘贴链接
2. 选 1080P
3. 等到 99% 出现错误

### Error Logs

\`\`\`shell
ERROR: unable to download video data: HTTP Error 403
\`\`\`
`)
  t.equal(v.close, false, '有描述、有版本、有原始报错，是有效报告')
})

// ===== 真实报告：绝不能关 =====

suite.case('带原始报错的报告（#50 page-reload）不能关', async (t) => {
  const v = classifyIssue(ISSUE_50)
  t.equal(v.close, false, '代码块里是真实报错，属于解析回归的线索')
  t.equal(v.reason, 'ok')
})

suite.case('带链接的不支持网址报告（#52）不能关', async (t) => {
  // 这条虽然类别是 invalid-url（自助类），但带着用户链接与原始报错，
  // 很可能是「某站点被误判成不支持」——需要人工判断
  const v = classifyIssue(ISSUE_52)
  t.equal(v.close, false, '含原始报错与链接，可能是站点支持的误判')
})

suite.case('authentication 但带原始报错（#57）不能关', async (t) => {
  // 同样是 authentication，但有代码块 → 可能是真的解析回归，不是让用户配 Cookie 就完事
  const v = classifyIssue(ISSUE_57)
  t.equal(v.close, false, '有原始报错就不该按「自助类」关掉')
})

suite.case('简短但有效的报告不能因为短就关掉', async (t) => {
  // 一句话的报告（如「选 1080P 之后卡在 0%」）是有效的，不能按长度一刀切
  const v = classifyIssue('### Issue Description\n\n选 1080P 之后进度一直卡在 0%\n\n### Steps to Reproduce\n\n1. 粘贴链接\n2. 选 1080P\n3. 卡住')
  t.equal(v.close, false, '有具体现象描述就是有效报告')
})

suite.case('#79：用户补了一句话，不能因为短就当成空报告', async (t) => {
  // 只看正文：那句话只有 11 个字，但它就是用户的输入。中文一个字往往就是一个词，
  // 按字符数设门槛（此前是 24）等于把一句完整的描述当成噪音
  const v = classifyIssue(ISSUE_79)
  t.equal(v.close, false, '正文里有用户写的内容')
  t.equal(v.reason, 'ok')
})

suite.case('#79：链接补在标题里，与写在正文里同等对待', async (t) => {
  // 用户常把链接直接追加在预填的标题后面；只看正文时它完全不可见
  t.equal(classifyIssue(ISSUE_78, ISSUE_79_TITLE).close, false, '正文是空模板，但标题里有用户补的链接')
  t.equal(classifyIssue(ISSUE_79, ISSUE_79_TITLE).close, false, '#79 原样（标题 + 正文）')
  // 自助类同理：链接是可复现的线索（同 #52 的口径），不该按「配 Cookie 即可」关掉
  const title = '[Bug] 该视频需要登录或访问权限，请检查 Cookies 设置 https://www.youtube.com/watch?v=8atq1TtMPZM'
  t.equal(classifyIssue(ISSUE_58, title).close, false, '自助类别，但标题带链接')
})

suite.case('标题只当作「有输入」的证据，不参与判定错误类别', async (t) => {
  // 标题是用户随手写的。拿它判类别的话，标题里一个「登录」就会把报告改判成
  // authentication、按自助类关掉——多传一个标题只能让判定更保守，不能多关一条
  const v = classifyIssue('## 问题描述\n\n点了下载之后应用直接闪退，重新打开也没有任务记录。', '[Bug] 登录 B 站之后下载就闪退')
  t.equal(v.kind, 'unknown')
  t.equal(v.close, false)
})

suite.case('用户手写的问题描述不会被误判成空报告', async (t) => {
  const v = classifyIssue(`## 问题描述

我用 B 站链接下载，选 1080P 之后进度条一直卡在 0%，等十分钟也没动。
换成 720P 就正常。浏览器里能正常播放。

## 环境信息

- 操作系统: macOS`)
  t.equal(v.close, false, '这是正常报告')
})

// ===== 自助类（无报错）：关闭并给出可行动指引 =====

suite.case('无报错的 authentication 走自助关闭', async (t) => {
  // 用户自己描述了一下、但没贴原始报错：应当关闭，并给出「怎么配 Cookie」的步骤
  const v = classifyIssue(`## 问题描述

我下载 YouTube 视频一直提示需要登录，不知道 Cookie 要怎么弄。

## 环境信息

- 操作系统: Windows 11`)
  t.equal(v.close, true)
  t.equal(v.reason, 'self-service', '有用户描述但没有原始报错 → 自助类')
  t.ok(commentFor(v).includes('Cookies'), '关评里必须给出具体的解决步骤')
})

suite.case('无法归类的空报告才走「你什么都没写」的回复', async (t) => {
  // 兜底路径：类别也识别不出来（unknown）+ 正文没内容 → 只能请用户补充信息
  const v = classifyIssue('## 问题描述\n\n无法解析该链接')
  t.equal(v.close, true)
  t.equal(v.reason, 'template-only')
  t.ok(commentFor(v).includes('重新提交'), '空报告的关评应请用户补充信息')
})

suite.case('每种自助类别的关评都要给出可行动的指引', async (t) => {
  // 用户描述 + 错误类别，但不贴原始报错 → 自助类
  const cases = [
    ['authentication', 'Cookies'],
    ['access-denied', '403'],
    ['rate-limit', '重试'],
    ['runtime-unavailable', 'Node.js'],
    ['not-found', '删除'],
  ]
  for (const [kind, expect] of cases) {
    const v = classifyIssue(`## 问题描述\n\n我这边一直失败，麻烦看看是什么原因。\n\n## 脱敏诊断\n\n错误类别：${kind}`)
    t.equal(v.close, true, `${kind} 应关闭`)
    t.equal(v.reason, 'self-service', `${kind} 应走自助类`)
    t.ok(commentFor(v).includes(expect), `${kind} 的关评应包含「${expect}」`)
  }
})

suite.case('未知类别的报错不自动关闭（拿不准就放行）', async (t) => {
  // unknown 可能对应我们还没归类的真实缺陷，宁可人工看一眼
  const v = classifyIssue(`## 问题描述

点了下载之后应用直接闪退，重新打开也没有任务记录，试了三次都一样。

## 脱敏诊断

错误类别：unknown`)
  t.equal(v.close, false)
  t.equal(v.reason, 'ok')
})

// ===== 关评文案本身 =====

suite.case('关评是中英双语，且不会泄露任何环境信息', async (t) => {
  for (const body of [ISSUE_58, '错误类别：authentication']) {
    const comment = commentFor(classifyIssue(body))
    t.ok((comment.match(/[a-zA-Z]/g) || []).length > 80, '应包含成段的英文（仓库有海外用户）')
    t.ok(comment.includes('自动关闭'), '应说明是自动关闭')
    t.ok(!/\/Users\/|\/home\/|[A-Z]:\\|@\d+\.\d+\.\d+/.test(comment), '不应包含路径或版本等环境信息')
    // 自动回复里绝不能有 @用户名 / #编号：GitHub 会据此发通知、建交叉引用，
    // 一条机器人的回复不该去打扰无关的人
    t.ok(!/@[a-zA-Z0-9]/.test(comment), '不应包含 @ 提及（会触发无关通知）')
    t.ok(!/#\d+/.test(comment), '不应包含 #编号（会触发交叉引用）')
  }
})

await suite.run()
