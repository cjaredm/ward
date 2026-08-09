-- Hand-typed address for households that have no county parcel behind them.
--
-- Parcel-backed households read their address from parcels.address, which the
-- county maintains. A pinned household has no parcel, so the address has to live
-- on the household itself.
--
-- Missed in 0003, which added `location` but not this. Every /api/parcels
-- request 500'd on `column h.address does not exist` until this landed.

ALTER TABLE households ADD COLUMN address text;
