/**
 * Side-effect flag proving a lazily imported component module is not evaluated
 * merely by importing the route definition that references it or by rendering a
 * link to its path.
 *
 * @since 0.4.0
 */
export const lazyState: { evaluated: boolean } = { evaluated: false }
