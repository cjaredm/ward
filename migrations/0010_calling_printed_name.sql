-- Keep callings whose holder is not in the ward data yet.
--
-- The first import wrote 279 of the report's ~350 callings. The missing ones
-- were held by people with no row in `people` — mostly youth, who are in the
-- callings report but were never in the directory export that seeded households.
-- A calling that cannot be matched to a person was simply dropped, so the org
-- chart quietly showed a Teachers Quorum with no president in it.
--
-- Dropping is the wrong answer: the report says somebody holds that calling, and
-- an org chart that hides it is worse than one that shows a name it cannot link.
-- So an unmatched calling is now stored with `person_id` NULL and the name as
-- printed. That is also what makes the members import useful later — those rows
-- get linked up once the people behind them exist.
--
-- A NULL person_id now means one of two things, told apart by this column:
--   printed_name IS NULL      the report printed 'Calling Vacant'
--   printed_name IS NOT NULL  somebody holds it, we just cannot say who yet

ALTER TABLE callings ADD COLUMN printed_name text;
