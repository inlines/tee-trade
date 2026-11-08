SELECT p.id, p.name, count(*) AS views
FROM product_views v
JOIN products p ON p.id = v.product_id
WHERE v.created_at >= now()-($1::bigint*interval '1 second') AND NOT p.is_demo
GROUP BY p.id, p.name
ORDER BY views DESC, p.id
LIMIT 20
