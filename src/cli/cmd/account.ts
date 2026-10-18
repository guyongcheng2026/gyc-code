import { cmd } from "./cmd"
import { Duration, Effect, Match, Option } from "effect"
import { UI } from "../ui"
import { Account } from "@/account/account"
import { Usage } from "@/billing/usage"
import { AccountID, OrgID, PollExpired, type PollResult, type AccountError } from "@/account/schema"
import { effectCmd } from "../effect-cmd"
import * as Prompt from "../effect/prompt"
import { openUrl } from "@gyccode/core/open"

const openBrowser = (url: string) => Effect.promise(() => openUrl(url).catch(() => undefined))

const println = (msg: string) => Effect.sync(() => UI.println(msg))

const dim = (value: string) => UI.Style.TEXT_DIM + value + UI.Style.TEXT_NORMAL

const activeSuffix = (isActive: boolean) => (isActive ? dim(" （当前）") : "")

export const defaultConsoleUrl = process.env.GYCCODE_ACCOUNT_URL ?? "http://localhost:8787"

export const formatAccountLabel = (account: { email: string; url: string }, isActive: boolean) =>
  `${account.email} ${dim(account.url)}${activeSuffix(isActive)}`

const formatOrgChoiceLabel = (account: { email: string }, org: { name: string }, isActive: boolean) =>
  `${org.name} (${account.email})${activeSuffix(isActive)}`

export const formatOrgLine = (
  account: { email: string; url: string },
  org: { id: string; name: string },
  isActive: boolean,
) => {
  const dot = isActive ? UI.Style.TEXT_SUCCESS + "●" + UI.Style.TEXT_NORMAL : " "
  const name = isActive ? UI.Style.TEXT_HIGHLIGHT_BOLD + org.name + UI.Style.TEXT_NORMAL : org.name
  return `  ${dot} ${name}  ${dim(account.email)}  ${dim(account.url)}  ${dim(org.id)}`
}

const isActiveOrgChoice = (
  active: Option.Option<{ id: AccountID; active_org_id: OrgID | null }>,
  choice: { accountID: AccountID; orgID: OrgID },
) => Option.isSome(active) && active.value.id === choice.accountID && active.value.active_org_id === choice.orgID

const loginEffect = Effect.fn("login")(function* (url: string) {
  const service = yield* Account.Service

  yield* Prompt.intro("登录")
  const login = yield* service.login(url)

  yield* Prompt.log.info("请访问： " + login.url)
  yield* Prompt.log.info("输入代码： " + login.user)
  yield* openBrowser(login.url)

  const s = Prompt.spinner()
  yield* s.start("正在等待授权…")

  const poll = (wait: Duration.Duration): Effect.Effect<PollResult, AccountError> =>
    Effect.gen(function* () {
      yield* Effect.sleep(wait)
      const result = yield* service.poll(login)
      if (result._tag === "PollPending") return yield* poll(wait)
      if (result._tag === "PollSlow") return yield* poll(Duration.sum(wait, Duration.seconds(5)))
      return result
    })

  const result = yield* poll(login.interval).pipe(
    Effect.timeout(login.expiry),
    Effect.catchTag("TimeoutError", () => Effect.succeed(new PollExpired())),
  )

  yield* Match.valueTags(result, {
    PollSuccess: (r) =>
      Effect.gen(function* () {
        yield* s.stop("已登录为 " + r.email)
        yield* Prompt.outro("完成")
      }),
    PollExpired: () => s.stop("设备码已过期"),
    PollDenied: () => s.stop("授权被拒绝"),
    PollError: (r) => s.stop("错误： " + String(r.cause)),
    PollPending: () => s.stop("意外的状态"),
    PollSlow: () => s.stop("意外的状态"),
  })
})

const logoutEffect = Effect.fn("logout")(function* (email?: string) {
  const service = yield* Account.Service
  const accounts = yield* service.list()
  if (accounts.length === 0) return yield* println("未登录")

  if (email) {
    const match = accounts.find((a) => a.email === email)
    if (!match) return yield* println("未找到账户： " + email)
    yield* service.remove(match.id)
    yield* Prompt.outro("已登出 " + email)
    return
  }

  const active = yield* service.active()
  const activeID = Option.map(active, (a) => a.id)

  yield* Prompt.intro("登出")

  const opts = accounts.map((a) => {
    const isActive = Option.isSome(activeID) && activeID.value === a.id
    return {
      value: a,
      label: formatAccountLabel(a, isActive),
    }
  })

  const selected = yield* Prompt.select({ message: "选择要登出的账户", options: opts })
  if (Option.isNone(selected)) return

  yield* service.remove(selected.value.id)
  yield* Prompt.outro("已登出 " + selected.value.email)
})

interface OrgChoice {
  orgID: OrgID
  accountID: AccountID
  label: string
}

const switchEffect = Effect.fn("switch")(function* () {
  const service = yield* Account.Service

  const groups = yield* service.orgsByAccount()
  if (groups.length === 0) return yield* println("未登录")

  const active = yield* service.active()

  const opts = groups.flatMap((group) =>
    group.orgs.map((org) => {
      const isActive = isActiveOrgChoice(active, { accountID: group.account.id, orgID: org.id })
      return {
        value: { orgID: org.id, accountID: group.account.id, label: org.name },
        label: formatOrgChoiceLabel(group.account, org, isActive),
      }
    }),
  )
  if (opts.length === 0) return yield* println("未找到组织")

  yield* Prompt.intro("切换组织")

  const selected = yield* Prompt.select<OrgChoice>({ message: "选择组织", options: opts })
  if (Option.isNone(selected)) return

  const choice = selected.value
  yield* service.use(choice.accountID, Option.some(choice.orgID))
  yield* Prompt.outro("已切换到 " + choice.label)
})

const orgsEffect = Effect.fn("orgs")(function* () {
  const service = yield* Account.Service

  const groups = yield* service.orgsByAccount()
  if (groups.length === 0) return yield* println("未找到账户")
  if (!groups.some((group) => group.orgs.length > 0)) return yield* println("未找到组织")

  const active = yield* service.active()

  for (const group of groups) {
    for (const org of group.orgs) {
      const isActive = isActiveOrgChoice(active, { accountID: group.account.id, orgID: org.id })
      yield* println(formatOrgLine(group.account, org, isActive))
    }
  }
})

const openEffect = Effect.fn("open")(function* () {
  const service = yield* Account.Service
  const active = yield* service.active()
  if (Option.isNone(active)) return yield* println("没有活跃账户")

  const url = active.value.url
  yield* openBrowser(url)
  yield* Prompt.outro("已打开 " + url)
})

const formatResetAt = (ms: number) => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const balanceEffect = Effect.fn("balance")(function* () {
  const account = yield* Account.Service
  const usage = yield* Usage.Service
  const active = yield* account.active().pipe(Effect.orElseSucceed(() => Option.none()))
  if (Option.isNone(active)) return yield* println("未登录，请先执行：gyc account login")

  yield* println(`账户：${active.value.email}`)

  const info = yield* usage.query()
  if (Option.isNone(info)) {
    return yield* println("积分信息暂不可用（账号服务未连接），本地会话不受影响")
  }

  const v = info.value
  const percent = v.monthlyQuota > 0 ? `（${((v.monthlyUsed / v.monthlyQuota) * 100).toFixed(1)}%）` : ""
  yield* println(`套餐：${v.planName}（月度 ${v.monthlyQuota} 积分）`)
  yield* println(`余额：${v.balance.toFixed(2)} 积分`)
  yield* println(`本月已用：${v.monthlyUsed.toFixed(2)} / ${v.monthlyQuota} 积分${percent}`)
  yield* println(`下次重置：${formatResetAt(v.resetAt)}`)
})

const rechargeEffect = Effect.fn("recharge")(function* () {
  const account = yield* Account.Service
  const active = yield* account.active().pipe(Effect.orElseSucceed(() => Option.none()))

  // 优先自建充值页；未配置时打开账号服务的套餐说明页
  const url = process.env.GYCCODE_UPGRADE_URL ?? (Option.isSome(active) ? `${active.value.url}/plans` : undefined)
  if (!url) {
    return yield* println("未登录且未配置充值页面，请先执行：gyc account login")
  }

  yield* openBrowser(url)
  yield* Prompt.outro("已打开充值页面 " + url)
  yield* println("提示：自建服务不提供在线支付，请联系管理员为账号入账积分")
})

export const LoginCommand = effectCmd({
  command: "login [url]",
  describe: false,
  instance: false,
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "服务器 URL",
      type: "string",
    }),
  handler: Effect.fn("Cli.account.login")(function* (args) {
    UI.empty()
    yield* Effect.orDie(loginEffect(args.url ?? defaultConsoleUrl))
  }),
})

export const LogoutCommand = effectCmd({
  command: "logout [email]",
  describe: false,
  instance: false,
  builder: (yargs) =>
    yargs.positional("email", {
      describe: "要登出的账户邮箱",
      type: "string",
    }),
  handler: Effect.fn("Cli.account.logout")(function* (args) {
    UI.empty()
    yield* Effect.orDie(logoutEffect(args.email))
  }),
})

export const SwitchCommand = effectCmd({
  command: "switch",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.account.switch")(function* () {
    UI.empty()
    yield* Effect.orDie(switchEffect())
  }),
})

export const OrgsCommand = effectCmd({
  command: "orgs",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.account.orgs")(function* () {
    UI.empty()
    yield* Effect.orDie(orgsEffect())
  }),
})

export const OpenCommand = effectCmd({
  command: "open",
  describe: false,
  instance: false,
  handler: Effect.fn("Cli.account.open")(function* () {
    UI.empty()
    yield* Effect.orDie(openEffect())
  }),
})

export const BalanceCommand = effectCmd({
  command: "balance",
  describe: "查看积分余额与本月用量",
  instance: false,
  handler: Effect.fn("Cli.account.balance")(function* () {
    UI.empty()
    yield* balanceEffect()
  }),
})

export const RechargeCommand = effectCmd({
  command: "recharge",
  describe: "打开套餐与充值说明页",
  instance: false,
  handler: Effect.fn("Cli.account.recharge")(function* () {
    UI.empty()
    yield* rechargeEffect()
  }),
})

export const ConsoleCommand = cmd({
  command: "console",
  describe: false,
  builder: (yargs) =>
    yargs
      .command({
        ...LoginCommand,
        describe: "登录控制台",
      })
      .command({
        ...LogoutCommand,
        describe: "登出控制台",
      })
      .command({
        ...SwitchCommand,
        describe: "切换活跃组织",
      })
      .command({
        ...OrgsCommand,
        describe: "列出组织",
      })
      .command({
        ...OpenCommand,
        describe: "打开活跃的控制台账户",
      })
      .command({
        ...BalanceCommand,
        describe: "查看积分余额与本月用量",
      })
      .command({
        ...RechargeCommand,
        describe: "打开套餐与充值说明页",
      })
      .demandCommand(),
  async handler() {},
})
