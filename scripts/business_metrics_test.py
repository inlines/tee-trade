"""Test cohort SQL in temporary tables; real shop rows are never changed."""
import json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
setup="""
BEGIN;
CREATE TEMP TABLE customers(id bigint,created_at timestamptz);
CREATE TEMP TABLE product_views(product_id int,customer_id bigint,visitor_hash text,created_at timestamptz);
CREATE TEMP TABLE purchase_requests(customer_id bigint,product_id int,status text,created_at timestamptz,updated_at timestamptz);
CREATE TEMP TABLE chats(id bigint,customer_id bigint,product_id int);
CREATE TEMP TABLE chat_messages(chat_id bigint,is_admin boolean,created_at timestamptz);
INSERT INTO customers VALUES(1,now()-interval '3 days'),(2,now()-interval '10 days'),(3,now()-interval '10 days'),(4,now()-interval '1 hour');
INSERT INTO product_views VALUES(10,1,'a',now()-interval '2 days'),(20,2,'b',now()-interval '10 days'),(30,3,'c',now()-interval '1 day'),(40,NULL,'d',now()-interval '1 hour');
INSERT INTO purchase_requests VALUES(1,10,'completed',now()-interval '1 day',now()),(2,20,'new',now()-interval '1 day',now()),(3,30,'new',now()-interval '2 days',now());
INSERT INTO chats VALUES(10,1,10),(20,2,20),(30,3,30);
INSERT INTO chat_messages VALUES(10,false,now()-interval '36 hours'),(10,true,now()-interval '35 hours'),(20,false,now()-interval '10 days'),(30,false,now()-interval '1 day');
"""
def run(file):
 query=(root/'backend/src'/file).read_text().strip().rstrip(';').replace('$1','2592000')
 sql=setup+"\nSELECT json_object_agg(key,value) FROM ("+query+") AS result(key,value);\nROLLBACK;"
 output=subprocess.check_output(['docker','compose','exec','-T','postgres','sh','-c','psql -X -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'],input=sql,text=True,cwd=root)
 return json.loads(output)
assert run('business_funnel.sql')=={'view_pairs':3,'view_to_request':1,'view_to_chat':3,'message_pairs':3,'message_to_request':1,'registered_customers':4,'registration_to_request':1}
assert run('business_events.sql')=={'registrations':4,'views':4,'views_authenticated':3,'views_anonymous':1,'viewers':4,'requests':3,'request_customers':3,'completed_requests':1,'buyer_messages':3,'admin_messages':1,'active_chats':3}
print('PASS: business counts, guest separation, 7-day attribution, request-before-view exclusion, role separation; temporary tables rolled back')
