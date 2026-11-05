-- Keep legacy bytes until export + verification + explicit pruning.
ALTER TABLE media ALTER COLUMN content DROP NOT NULL;
ALTER TABLE media ADD COLUMN content_sha256 TEXT;
ALTER TABLE media ADD COLUMN preview_sha256 TEXT;
ALTER TABLE media ADD COLUMN content_size BIGINT;
ALTER TABLE media ADD COLUMN preview_size BIGINT;
CREATE TABLE media_file_deletions (id TEXT PRIMARY KEY);
CREATE FUNCTION queue_media_file_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO media_file_deletions(id) VALUES (OLD.id) ON CONFLICT DO NOTHING;
  RETURN OLD;
END;
$$;
CREATE TRIGGER media_file_deleted AFTER DELETE ON media
FOR EACH ROW EXECUTE FUNCTION queue_media_file_deletion();
