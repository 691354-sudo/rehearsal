-- SQLite report for ONE authenticated profile database. No message text is read.
-- Edit the two UTC timestamps below. End is exclusive; NULL means no bound.
-- Run this file in the project's SQLite interface, or sqlite3 -header -column <profile.sqlite> < this-file.
DROP TABLE IF EXISTS temp.echo_tutor_report_parameters;
CREATE TEMP TABLE echo_tutor_report_parameters(start_utc TEXT, end_utc TEXT);
INSERT INTO echo_tutor_report_parameters VALUES (
  strftime('%Y-%m-%dT00:00:00.000Z', 'now', '-30 days'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 second')
);

-- REPORT QUERY
WITH periods(period, start_utc, end_utc) AS (
  SELECT 'Selected period', start_utc, end_utc FROM echo_tutor_report_parameters
  UNION ALL SELECT 'All time', NULL, NULL
), events(kind, target_language, data, created_at) AS (
  SELECT kind, target_language, data, created_at FROM tutor_adaptation_events
  UNION ALL
  SELECT CASE kind WHEN 'listen_like' THEN 'card_liked' WHEN 'to_recall' THEN 'card_sent_to_recall' END,
    COALESCE(json_extract(data, '$.language'), 'en'), '{}', occurred_at
  FROM pilot_events WHERE kind IN ('listen_like', 'to_recall')
), metrics(label, event_kind, filter_value, count_users) AS (
  VALUES
    ('Users who started onboarding', 'tutor_onboarding_started', NULL, 1),
    ('Users who completed onboarding', 'tutor_onboarding_completed', NULL, 1),
    ('Users who skipped onboarding', 'tutor_onboarding_skipped', NULL, 1),
    ('Funnel views', 'tutor_funnel_viewed', NULL, 0),
    ('Initial support: more help', 'tutor_initial_mode_selected', 'beginner', 1),
    ('Initial support: together', 'tutor_initial_mode_selected', 'intermediate', 1),
    ('Initial support: independently', 'tutor_initial_mode_selected', 'advanced', 1),
    ('Completed meaningful sessions', 'tutor_session_completed', NULL, 0),
    ('Reassessments: kept', 'tutor_mode_reassessment_completed', 'keep', 0),
    ('Reassessments: moved up', 'tutor_mode_reassessment_completed', 'move_up', 0),
    ('Reassessments: moved down', 'tutor_mode_reassessment_completed', 'move_down', 0),
    ('Direct requests changing mode', 'tutor_mode_changed', 'direct_request', 0),
    ('Direct requests changing overrides', 'tutor_user_override_changed', 'direct_request', 0),
    ('Users who reached first exercise', 'tutor_first_exercise_started', NULL, 1),
    ('Users who completed first exercise', 'tutor_first_exercise_completed', NULL, 1),
    ('Like actions', 'card_liked', NULL, 0),
    ('To Recall actions', 'card_sent_to_recall', NULL, 0),
    ('Session summary errors', 'tutor_summary_error', NULL, 0),
    ('Reassessment errors', 'tutor_reassessment_error', NULL, 0)
), totals AS (
  SELECT p.period, m.label AS metric,
    CASE WHEN m.count_users = 1 THEN CASE WHEN COUNT(e.kind) > 0 THEN 1 ELSE 0 END ELSE COUNT(e.kind) END AS value,
    CASE WHEN m.count_users = 1 THEN 'users in this profile database' ELSE 'events' END AS unit
  FROM periods p CROSS JOIN metrics m
  LEFT JOIN events e ON e.kind = m.event_kind
    AND (p.start_utc IS NULL OR e.created_at >= p.start_utc)
    AND (p.end_utc IS NULL OR e.created_at < p.end_utc)
    AND (m.filter_value IS NULL OR m.filter_value IN (json_extract(e.data, '$.to_mode'), json_extract(e.data, '$.decision'), json_extract(e.data, '$.trigger')))
  GROUP BY p.period, m.label
), latency AS (
  SELECT p.period, 'Average time to first exercise' AS metric,
    ROUND(AVG(json_extract(e.data, '$.seconds_since_onboarding_start')), 1) AS value, 'seconds' AS unit
  FROM periods p LEFT JOIN events e ON e.kind = 'tutor_first_exercise_started'
    AND (p.start_utc IS NULL OR e.created_at >= p.start_utc) AND (p.end_utc IS NULL OR e.created_at < p.end_utc)
  GROUP BY p.period
), retention AS (
  SELECT p.period, 'D' || d.day || ' users returning after onboarding' AS metric,
    CASE WHEN COUNT(DISTINCT s.target_language) > 0 THEN 1 ELSE 0 END AS value, 'users in this profile database' AS unit
  FROM periods p CROSS JOIN (SELECT 1 AS day UNION ALL SELECT 7) d
  LEFT JOIN events s ON s.kind = 'tutor_onboarding_started'
    AND (p.start_utc IS NULL OR s.created_at >= p.start_utc) AND (p.end_utc IS NULL OR s.created_at < p.end_utc)
    AND EXISTS (SELECT 1 FROM events r WHERE r.kind = 'tutor_session_completed' AND r.target_language = s.target_language
      AND julianday(r.created_at) >= julianday(s.created_at) + d.day AND julianday(r.created_at) < julianday(s.created_at) + d.day + 1)
  GROUP BY p.period, d.day
)
SELECT * FROM totals UNION ALL SELECT * FROM latency UNION ALL SELECT * FROM retention
ORDER BY period, metric;
