CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  adult_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_tokens_user_purpose_idx ON email_tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS learning_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_journey_id UUID REFERENCES learning_journeys(id) ON DELETE SET NULL,
  parent_node_id UUID,
  query TEXT NOT NULL,
  title TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'general',
  introduction TEXT NOT NULL,
  progress_node_id UUID,
  progress_ratio NUMERIC(6,5) NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS journeys_user_last_opened_idx ON learning_journeys(user_id, last_opened_at DESC);

CREATE TABLE IF NOT EXISTS learning_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES learning_journeys(id) ON DELETE CASCADE,
  parent_node_id UUID REFERENCES learning_nodes(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL DEFAULT 'step' CHECK (node_type IN ('step', 'subtopic')),
  order_index INTEGER NOT NULL DEFAULT 0,
  depth INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  elaborate_prompt TEXT NOT NULL DEFAULT '',
  examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  elaborated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS nodes_journey_parent_order_idx ON learning_nodes(journey_id, parent_node_id, order_index);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journeys_progress_node_fk') THEN
    ALTER TABLE learning_journeys ADD CONSTRAINT journeys_progress_node_fk FOREIGN KEY (progress_node_id) REFERENCES learning_nodes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='journeys_parent_node_fk') THEN
    ALTER TABLE learning_journeys ADD CONSTRAINT journeys_parent_node_fk FOREIGN KEY (parent_node_id) REFERENCES learning_nodes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS source_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES learning_journeys(id) ON DELETE CASCADE,
  node_id UUID REFERENCES learning_nodes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(journey_id, url)
);
CREATE INDEX IF NOT EXISTS sources_journey_idx ON source_references(journey_id);

CREATE TABLE IF NOT EXISTS user_consents (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE learning_nodes ADD COLUMN IF NOT EXISTS examples JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('search','follow_up','elaborate')),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','succeeded','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ai_usage_user_created_idx ON ai_usage_events(user_id,created_at DESC);
