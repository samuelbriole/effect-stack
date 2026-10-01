import { describe, expect, test } from "tstyche"
import type * as Option from "effect/Option"
import type * as Router from "@effect-stack/router/Router"
import {
  projectPresentation,
  selectOutlet,
  type DisplayItem,
  type DisplaySnapshot,
  type PresentationState,
  type SnapshotOutletDecision,
  type ViewFailure
} from "@effect-stack/router/Presentation"

describe("generic renderer projection", () => {
  test("preserves custom inputs, failures, entries, and native views", () => {
    interface Failure {
      readonly message: string
    }
    interface Entry extends DisplayItem<number, Failure> {
      readonly native: boolean
    }
    interface View {
      readonly render: () => string
      readonly nativeView: true
    }
    const snapshot = {} as DisplaySnapshot<Entry, Failure>
    const fallback = {} as View
    const decision = selectOutlet(snapshot, 0, new Map<string, View>(), fallback)
    expect(decision).type.toBe<SnapshotOutletDecision<Entry, Failure, View>>()
    if (decision._tag === "View" || decision._tag === "Failure") {
      expect(decision.entry).type.toBe<Entry>()
      expect(decision.entry.input).type.toBe<number>()
      expect(decision.view).type.toBe<View>()
    }
    if (decision._tag === "Failure" || decision._tag === "RouterFailure") {
      expect(decision.failure).type.toBe<Failure>()
    }
  })

  test("projects core entries while keeping the canonical node", () => {
    const snapshot = projectPresentation({} as PresentationState)
    expect(snapshot).type.toBe<
      DisplaySnapshot<DisplayItem<Option.Option<unknown>, ViewFailure> & { readonly node: Router.AnyNode }, ViewFailure>
    >()
    if (snapshot._tag === "RouterFailure") expect(snapshot.failure).type.toBe<ViewFailure>()
  })
})
