WITH cutoff AS (SELECT now()-($1::bigint*interval '1 second') AS t),
views AS (
 SELECT customer_id,product_id,min(created_at) AS first_at FROM product_views,cutoff
 WHERE created_at>=t AND customer_id IS NOT NULL GROUP BY customer_id,product_id
),
messages AS (
 SELECT c.customer_id,c.product_id,min(m.created_at) AS first_at
 FROM chats c JOIN chat_messages m ON m.chat_id=c.id WHERE NOT m.is_admin
 GROUP BY c.customer_id,c.product_id
),
view_cohort AS (
 SELECT v.*,EXISTS(SELECT 1 FROM purchase_requests r WHERE r.customer_id=v.customer_id AND r.product_id=v.product_id AND r.created_at>=v.first_at AND r.created_at<=v.first_at+interval '7 days') AS converted FROM views v
),
message_cohort AS (
 SELECT m.*,EXISTS(SELECT 1 FROM purchase_requests r WHERE r.customer_id=m.customer_id AND r.product_id=m.product_id AND r.created_at>=m.first_at AND r.created_at<=m.first_at+interval '7 days') AS converted FROM messages m,cutoff WHERE m.first_at>=t
),
registration_cohort AS (
 SELECT u.id,EXISTS(SELECT 1 FROM purchase_requests r WHERE r.customer_id=u.id AND r.created_at>=u.created_at AND r.created_at<=u.created_at+interval '7 days') AS converted FROM customers u,cutoff WHERE u.created_at>=t
)
SELECT 'view_pairs'::text,count(*) FROM view_cohort
UNION ALL SELECT 'view_to_request',count(*) FROM view_cohort WHERE converted
UNION ALL SELECT 'view_to_chat',count(*) FROM view_cohort v WHERE EXISTS (SELECT 1 FROM chats c JOIN chat_messages m ON m.chat_id=c.id WHERE c.customer_id=v.customer_id AND c.product_id=v.product_id AND NOT m.is_admin AND m.created_at>=v.first_at AND m.created_at<=v.first_at+interval '7 days')
UNION ALL SELECT 'message_pairs',count(*) FROM message_cohort
UNION ALL SELECT 'message_to_request',count(*) FROM message_cohort WHERE converted
UNION ALL SELECT 'registered_customers',count(*) FROM registration_cohort
UNION ALL SELECT 'registration_to_request',count(*) FROM registration_cohort WHERE converted
