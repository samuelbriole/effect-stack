import { RouterMessage, State } from "@effect-stack/router-foldkit"
import { Schema } from "effect"

// The snapshot schema does not depend on routes, so Model can precede route views.
export const Model = Schema.Struct({ router: State, count: Schema.Number, changingAccess: Schema.Boolean })
export type Model = typeof Model.Type

export const GotRouter = Schema.TaggedStruct("GotRouter", { message: RouterMessage })
export const ClickedIncrement = Schema.TaggedStruct("ClickedIncrement", {})
export const ClickedUnlock = Schema.TaggedStruct("ClickedUnlock", {})
export const ClickedLock = Schema.TaggedStruct("ClickedLock", {})
export const ChangedAccess = Schema.TaggedStruct("ChangedAccess", { allowed: Schema.Boolean })
export const Message = Schema.Union([GotRouter, ClickedIncrement, ClickedUnlock, ClickedLock, ChangedAccess])
export type Message = typeof Message.Type
