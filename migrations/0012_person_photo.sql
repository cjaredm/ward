-- A photo per person, stored as a URL.
--
-- A link and not an image: the ward has no photo store, and the pictures that
-- exist already live somewhere that serves them. Keeping the link means this app
-- never becomes a second copy of a photo of a minor -- the same reasoning as
-- 0011, which dropped phone and email -- and revoking access at the source
-- revokes it here too.
--
-- Expected to stay NULL for most people. Photos arrive a handful at a time, so
-- the UI draws initials when there is none rather than a hole: a ward with three
-- photos has to look deliberate, not half-broken.
ALTER TABLE people ADD COLUMN photo_url text;

-- https only, enforced here rather than in whichever route wrote last: the value
-- goes straight into an <img src>, so 'javascript:', 'data:' and plain http must
-- not be storable at all. The length cap keeps a pasted mega-URL out of every
-- household payload.
ALTER TABLE people ADD CONSTRAINT people_photo_url_https
  CHECK (photo_url IS NULL OR (photo_url ~ '^https://.' AND length(photo_url) <= 2000));
