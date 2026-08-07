import { cmd } from "./cmd"
import { Composer } from "../../composer/index"

export const ComposeCommand = cmd({
  command: "compose",
  describe: "manage compose workflow plans",
  builder: (yargs) =>
    yargs
      .command({
        command: "plan <message>",
        describe: "generate a compose workflow plan",
        builder: (yargs) =>
          yargs.positional("message", {
            type: "string",
            demandOption: true,
            describe: "requirement description",
          }),
        handler: (argv) => {
          const plan = Composer.plan(argv.message as string)
          console.log(`Plan: ${plan.name}`)
          plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.action}`))
        },
      })
      .command({
        command: "skills",
        describe: "list available skills",
        handler: async () => {
          const skills = await Composer.listSkills()
          console.log("Available skills:")
          skills.forEach((s) => console.log(`  - ${s}`))
        },
      })
      .demandCommand(),
  async handler() {},
})