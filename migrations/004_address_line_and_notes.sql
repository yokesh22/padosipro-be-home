-- 004_address_line_and_notes.sql
-- Fit addresses to the app's "A few details" form, which collects a
-- free-text address, society, flat and entry notes, but no city.
--
--   address_line : free text "address & area", may contain line breaks
--   notes        : gate / entry instructions for the service provider
--   area, city   : no longer required (the form doesn't collect them yet)
--
-- flat_unit stays required. Safe on a table with existing rows: it only
-- adds nullable columns and relaxes constraints.

BEGIN;

alter table addresses
  add column address_line text,
  add column notes        text;

alter table addresses
  alter column area drop not null,
  alter column city drop not null;

COMMIT;
