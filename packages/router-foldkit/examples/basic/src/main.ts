import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import type { ConnectionId } from "@effect-stack/router-foldkit"
import { Effect, Layer } from "effect"
import * as Command from "foldkit/command"
import type { Document, HtmlBuilder } from "foldkit/html"
import * as Runtime from "foldkit/runtime"
import type * as Update from "foldkit/update"
import { Access, AccessLive } from "./access.ts"
import { ChangedAccess, ClickedLock, Model, type Message } from "./model.ts"
import { App, Home, ProjectIndex, projectId, restrictedProjectId } from "./routes.ts"
import "./styles.css"

const connection = App.connect(App.layer.pipe(Layer.provide(Layer.merge(BrowserHistory.layer, AccessLive))))

const ChangeAccess = Command.define("Example.ChangeAccess", {
  args: { allowed: ChangedAccess.fields.allowed },
  messages: [ChangedAccess],
  execute: ({ allowed }) =>
    Effect.gen(function* () {
      const access = yield* Access
      yield* access.setAllowed(allowed)
      return ChangedAccess.make({ allowed })
    }).pipe(Effect.provide(AccessLive))
})

// The annotation prevents route/view/update inference cycles and preserves the
// connection requirement in the application's own update function.
const update = (model: Model, message: Message): Update.Return<Model, Message, ConnectionId<"Example">> => {
  switch (message._tag) {
    case "GotRouter":
      return App.update(model, message.message)
    case "ClickedIncrement":
      return { model: { ...model, count: model.count + 1 } }
    case "ClickedUnlock":
      return {
        model: { ...model, changingAccess: true },
        commands: [ChangeAccess({ allowed: true })]
      }
    case "ClickedLock":
      return {
        model: { ...model, changingAccess: true },
        commands: [ChangeAccess({ allowed: false })]
      }
    case "ChangedAccess": {
      const next = { ...model, changingAccess: false }
      const intent = message.allowed
        ? App.retry()
        : App.navigate(ProjectIndex.to({ params: { projectId: restrictedProjectId } }))
      return update(next, intent)
    }
  }
}

const viewDocument = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "EffectStack Router · Foldkit",
  body: h.main(
    [],
    [
      h.h1([], ["EffectStack Router · Foldkit"]),
      h.nav(
        [],
        [
          App.link(h, Home.to(), ["Home"]),
          App.link(h, ProjectIndex.to({ params: { projectId } }), ["Project 42"]),
          h.button([h.OnClick(ClickedLock.make({})), h.Disabled(model.changingAccess)], ["Lock and open Project 13"]),
          h.button([h.OnClick(App.back())], ["Back"]),
          h.button([h.OnClick(App.forward())], ["Forward"]),
          h.button([h.OnClick(App.refresh())], ["Refresh gates"])
        ]
      ),
      App.view(model, h)
    ]
  )
})

const application = Runtime.makeApplication({
  Model,
  init: () => ({ model: { router: App.initialState, count: 0, changingAccess: false } }),
  update,
  view: viewDocument,
  resources: connection.resources,
  subscriptions: connection.subscriptions,
  container: document.getElementById("root")
  // No Foldkit routing config: EffectStack owns history and marked links.
})

Runtime.run(application)
