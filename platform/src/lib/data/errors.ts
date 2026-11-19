// Backend-neutral errors thrown by DataStore implementations (callers never match on SQL error text).
// No TS parameter properties here: the CLI scripts load this file with Node's type stripping.

/** A uniqueness rule was violated (e.g. another tenant already has this channel account connected). */
export class DataConflictError extends Error {
  readonly code = "conflict";
  constructor(message = "conflict") { super(message); this.name = "DataConflictError"; }
}

/** Input rejected by a data rule that mirrors a database CHECK constraint. */
export class DataValidationError extends Error {
  readonly code = "invalid";
  readonly field: string;
  constructor(field: string) { super(`invalid ${field}`); this.name = "DataValidationError"; this.field = field; }
}

export class DataBackendNotImplementedError extends Error {
  readonly code = "not_implemented";
  constructor(backend: string) {
    super(`DATA_BACKEND="${backend}" is not implemented yet (stage 2 of the Supabase migration). Use DATA_BACKEND=sqlite or leave it unset.`);
    this.name = "DataBackendNotImplementedError";
  }
}
