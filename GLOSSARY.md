# EffectStack Router

Router coordinates navigation and the branch displayed by an application.

## Language

**Endpoint**:
A page at an exact URL pattern. `index` is shorthand for an endpoint at its layout's own path.

**Layout**:
A parent that supplies inherited schemas, gates, and optional presentation around its descendants.

**Gate**:
An optional preparation requirement before accepting a displayed branch, with no returned data.
_Avoid_: route handler, loader

**Decoded route input**:
The decoded params, search, and hash together with the matched location; all sections are available, unlike optional destination input.

**Destination**:
An endpoint identity together with decoded URL input and navigation options.
_Avoid_: pathname alone

**Displayed branch**:
The resolved sequence of routes shown to the user, retained while an incoming URL is being prepared.

**Incoming URL**:
The observed location being prepared, which may differ from the displayed branch's location.
