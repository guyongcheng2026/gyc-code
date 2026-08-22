import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerGyccodeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
