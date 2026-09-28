-- Focused (topic) searches and case outcome for arrest-related pathways.
ALTER TABLE privacy_profiles
  ADD COLUMN case_outcome text NOT NULL DEFAULT 'NONE'
    CHECK (case_outcome IN ('NONE', 'PENDING', 'NOT_CHARGED', 'DISMISSED', 'ACQUITTED', 'EXPUNGED_OR_SEALED', 'CONVICTED'));

ALTER TABLE scans ADD COLUMN focus jsonb NOT NULL DEFAULT '{"topics": [], "customTerms": []}';
