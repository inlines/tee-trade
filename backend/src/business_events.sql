WITH cutoff AS (SELECT now()-($1::bigint*interval '1 second') AS t)
SELECT 'registrations'::text,count(*) FROM customers,cutoff WHERE created_at>=t
UNION ALL SELECT 'views',count(*) FROM product_views,cutoff WHERE created_at>=t
UNION ALL SELECT 'views_authenticated',count(*) FROM product_views,cutoff WHERE created_at>=t AND customer_id IS NOT NULL
UNION ALL SELECT 'views_anonymous',count(*) FROM product_views,cutoff WHERE created_at>=t AND customer_id IS NULL
UNION ALL SELECT 'viewers',count(DISTINCT visitor_hash) FROM product_views,cutoff WHERE created_at>=t
UNION ALL SELECT 'requests',count(*) FROM purchase_requests,cutoff WHERE created_at>=t
UNION ALL SELECT 'request_customers',count(DISTINCT customer_id) FROM purchase_requests,cutoff WHERE created_at>=t
UNION ALL SELECT 'completed_requests',count(*) FROM purchase_requests,cutoff WHERE status='completed' AND updated_at>=t
UNION ALL SELECT 'buyer_messages',count(*) FROM chat_messages,cutoff WHERE created_at>=t AND NOT is_admin
UNION ALL SELECT 'admin_messages',count(*) FROM chat_messages,cutoff WHERE created_at>=t AND is_admin
UNION ALL SELECT 'active_chats',count(DISTINCT chat_id) FROM chat_messages,cutoff WHERE created_at>=t
