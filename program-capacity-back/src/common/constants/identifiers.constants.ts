// What may arrive from outside as an identifier or a name, at the API and on the treasury feed alike.
// Control characters are excluded: PostgreSQL rejects NUL in text, so it must never reach a query.
export const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

export const PROGRAM_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export const DISPLAY_NAME_PATTERN = /^[^\p{Cc}]{1,200}$/u;
