// The refusals the abilities screen has to tell apart, pinned once.
//
// The stub, the stub contract spec and the live cross-repo contract all read
// this table, so "the stub is a stand-in for agenthub" is not a comment that
// can drift: a route and the assertion that checks it cannot disagree about a
// status or a machine code. Real agenthub's distribution handler is the source
// of truth (`internal/handlers/distribution.go`): an unknown/unauthorized id is
// 404 `not_found`, while a real record of the wrong kind is 400
// `invalid_kind` — answering "not found" there would send an operator hunting
// for a typo that is not there.
export const ERROR_CONTRACT = {
  invalidKind: {
    status: 400,
    code: 'invalid_kind',
    why: 'a real record whose kind cannot carry bindings',
  },
  notFound: {
    status: 404,
    code: 'not_found',
    why: 'no record with that id',
  },
}
