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

/**
 * The backend failed for a reason that is not the caller's input (network, permissions, missing migration...).
 * The message carries only the table/operation and the database error CODE: never values, details or row data
 * (Postgres error details can contain customer data such as phone numbers).
 */
export class DataBackendError extends Error {
  readonly code = "backend";
  readonly dbCode: string;
  constructor(message: string, dbCode = "") { super(message); this.name = "DataBackendError"; this.dbCode = dbCode; }
}

/** The configured backend does not offer this operation (yet). The message says what to use instead. */
export class DataBackendUnsupportedError extends Error {
  readonly code = "unsupported";
  constructor(message: string) { super(message); this.name = "DataBackendUnsupportedError"; }
}

/** @deprecated stage-1 placeholder (the Supabase backend exists now). Kept so old imports keep compiling. */
export class DataBackendNotImplementedError extends Error {
  readonly code = "not_implemented";
  constructor(backend: string) {
    super(`DATA_BACKEND="${backend}" is not implemented.`);
    this.name = "DataBackendNotImplementedError";
  }
}
