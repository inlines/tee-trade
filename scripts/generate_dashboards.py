"""Generate the provisioned Grafana dashboards; no Grafana API credentials needed."""
import json
from pathlib import Path
OUT=Path(__file__).resolve().parents[1]/'infra/grafana/dashboards'
DS={'type':'prometheus','uid':'prometheus'}
def dashboard(uid,title,period='now-6h'):
 return {'uid':uid,'title':title,'schemaVersion':39,'version':2,'refresh':'30s','timezone':'browser','tags':['futba'],'time':{'from':period,'to':'now'},'templating':{'list':[]},'panels':[],'links':[{'title':'API','url':'/d/tee-trade-api','type':'link'},{'title':'PostgreSQL','url':'/d/tee-trade-postgres','type':'link'},{'title':'Бизнес','url':'/d/tee-trade-business','type':'link'}]}
def panel(d,title,exprs,x,y,w=12,h=8,kind='timeseries',unit='short',desc='',thresholds=None):
 if isinstance(exprs,str):exprs=[(exprs,title)]
 p={'id':len(d['panels'])+1,'title':title,'description':desc,'type':kind,'datasource':DS,'gridPos':{'x':x,'y':y,'w':w,'h':h},
 'targets':[{'refId':chr(65+i),'expr':q,'legendFormat':name,'instant':kind in ['stat','bargauge'],'range':kind not in ['stat','bargauge']} for i,(q,name) in enumerate(exprs)],
 'fieldConfig':{'defaults':{'unit':unit,'noValue':'Нет данных','color':{'mode':'palette-classic'},'thresholds':{'mode':'absolute','steps':thresholds or [{'color':'green','value':None}]}},'overrides':[]},
 'options':{'legend':{'displayMode':'table','placement':'bottom','calcs':['lastNotNull','max']},'tooltip':{'mode':'multi','sort':'desc'}}}
 if kind=='stat':p['options']={'reduceOptions':{'calcs':['last'],'fields':'','values':False},'colorMode':'value','graphMode':'none','textMode':'auto','text':{'valueSize':28 if unit=='dateTimeAsIso' else 40,'titleSize':12}};p['fieldConfig']['defaults']['color']={'mode':'thresholds'}
 if kind=='bargauge':p['options']={'orientation':'horizontal','displayMode':'gradient','reduceOptions':{'calcs':['last'],'fields':'','values':False},'showUnfilled':True}
 d['panels'].append(p);return p
def note(d,text,y,h=3):
 d['panels'].append({'id':len(d['panels'])+1,'type':'text','title':'Как читать дашборд','gridPos':{'x':0,'y':y,'w':24,'h':h},'options':{'mode':'markdown','content':text}})
def save(d,file):
 legends={
  'Нагрузка по маршрутам':'{{route}}',
  '5xx по маршрутам':'{{route}}',
  '4xx по статусам':'{{status}}',
  'Самые медленные маршруты — p95':'{{route}}',
  'Открытые WebSocket':'{{kind}} / {{side}}',
  'Каталог: попадания, промахи и ошибки кеша':'{{result}}',
  'Задержка проверки зависимостей':'{{dependency}}',
  'Пул соединений приложения':'{{state}}',
  'Подключения по состоянию':'{{state}}',
  'Блокировки по типу':'{{mode}}',
  'Максимальная длительность транзакции':'{{state}}',
  'Размер таблиц — top 10':'{{relname}}',
  'Мёртвые строки — top 10':'{{relname}}',
  'Autovacuum по таблицам':'{{relname}}'}
 for p in d['panels']:
  if p['title'] in legends:
   for t in p['targets']:t['legendFormat']=legends[p['title']]
 (OUT/file).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def status(d,title,expr,x,y):
 p=panel(d,title,expr,x,y,6,4,'stat',thresholds=[{'color':'red','value':None},{'color':'green','value':1}])
 p['fieldConfig']['defaults']['mappings']=[{'type':'value','options':{'0':{'text':'НЕДОСТУПНО','color':'red'},'1':{'text':'OK','color':'green'}}}]
 return p
api=dashboard('tee-trade-api','FUTBA — активность и здоровье API')
api['templating']['list']=[{'name':'route','label':'Маршрут API','type':'query','datasource':DS,'query':'label_values(http_request_duration_seconds_count{route=~"/api/.*"}, route)','refresh':1,'includeAll':True,'allValue':'.*','multi':True,'current':{'text':'All','value':'$__all'}}]
status(api,'API / сбор метрик','up{job="tee-trade-api"}',0,0)
status(api,'PostgreSQL из приложения','tee_dependency_up{dependency="postgres"}',6,0)
status(api,'Redis из приложения','tee_dependency_up{dependency="redis"}',12,0)
panel(api,'Время работы API','time()-tee_api_start_timestamp_seconds',18,0,6,4,'stat','s')
flt='route=~"/api/.*",route=~"$route"'
rates='sum(rate(http_requests_total{'+flt+'}[$__rate_interval]))'
panel(api,'Запросов / сек',rates,0,4,6,4,'stat','reqps')
panel(api,'Ответов 5xx, %','100*(sum(rate(http_requests_total{'+flt+',status=~"5.."}[$__rate_interval])) or vector(0))/clamp_min('+rates+',0.000001)',6,4,6,4,'stat','percent',thresholds=[{'color':'green','value':None},{'color':'orange','value':1},{'color':'red','value':5}])
panel(api,'p95 ответа','histogram_quantile(0.95,sum by(le)(rate(http_request_duration_seconds_bucket{'+flt+'}[$__rate_interval])))',12,4,6,4,'stat','s')
panel(api,'Запросов в обработке','http_requests_in_flight',18,4,6,4,'stat',desc='Включает запрос /metrics. Считается до отправки заголовков; не включает время жизни WebSocket.')
panel(api,'Нагрузка по маршрутам','sum by(route)(rate(http_requests_total{'+flt+'}[$__rate_interval]))',0,8,12,8,unit='reqps')
panel(api,'Задержка p50 / p95 / p99',[(f'histogram_quantile({q},sum by(le)(rate(http_request_duration_seconds_bucket{{{flt}}}[$__rate_interval])))',name) for q,name in [(0.5,'p50'),(0.95,'p95'),(0.99,'p99')]],12,8,unit='s',desc='Время до заголовков ответа; WebSocket измеряет только handshake.')
panel(api,'5xx по маршрутам','sum by(route)(rate(http_requests_total{'+flt+',status=~"5.."}[$__rate_interval]))',0,16,unit='reqps')
panel(api,'4xx по статусам','sum by(status)(rate(http_requests_total{'+flt+',status=~"4.."}[$__rate_interval]))',12,16,unit='reqps',desc='401/403 могут быть ожидаемыми проверками сессии, а не неисправностью API.')
panel(api,'Самые медленные маршруты — p95','topk(10,histogram_quantile(0.95,sum by(le,route)(rate(http_request_duration_seconds_bucket{'+flt+'}[$__rate_interval]))))',0,24,kind='bargauge',unit='s')
panel(api,'Открытые WebSocket','sum by(kind,side)(tee_websocket_connections)',12,24,desc='chat — открытый диалог; notifications — поток уведомлений чата. Заявки используют polling.')
panel(api,'Каталог: попадания, промахи и ошибки кеша','sum by(result)(rate(tee_catalog_cache_total[$__rate_interval]))',0,32,unit='reqps')
panel(api,'Задержка проверки зависимостей','tee_dependency_probe_seconds',12,32,unit='s')
panel(api,'Пул соединений приложения','tee_db_pool_connections',0,40)
panel(api,'Время сбора метрик API','scrape_duration_seconds{job="tee-trade-api"}',12,40,unit='s')
# Catalog hit ratio excludes failed lookups; errors remain visible in separate panels.
hits='sum(increase(tee_catalog_cache_total{result="hit"}[$__range]))'
lookups='sum(increase(tee_catalog_cache_total{result=~"hit|miss"}[$__range]))'
ratio=f'100*{hits}/({lookups}>0)'
p=panel(api,'Redis: hit ratio за выбранный период',ratio,0,48,6,4,'stat','percent',desc='Доля ответов каталога из Redis: hit / (hit + miss). Ошибки чтения исключены и показаны отдельно. При отсутствии обращений — нет данных. Фильтр маршрута API на этот блок не влияет.')
p['fieldConfig']['defaults']['min']=0;p['fieldConfig']['defaults']['max']=100
panel(api,'Redis: попадания за период',hits,6,48,6,4,'stat',desc='Число ответов из кэша каталога за выбранный диапазон времени. increase может давать дробные значения из-за интерполяции между scrape.')
panel(api,'Redis: промахи за период','sum(increase(tee_catalog_cache_total{result="miss"}[$__range]))',12,48,6,4,'stat',desc='Ключ не найден: данные загружаются из PostgreSQL. После изменения товара версия кэша меняется; первые обращения закономерно дают промахи.')
panel(api,'Redis: ошибки чтения за период','sum(increase(tee_catalog_cache_total{result="error"}[$__range]))',18,48,6,4,'stat',desc='Таймаут, ошибка Redis или повреждённый JSON; запрос продолжает работать через PostgreSQL.',thresholds=[{'color':'green','value':None},{'color':'red','value':1}])
panel(api,'Redis: hit ratio во времени','100*sum(rate(tee_catalog_cache_total{result="hit"}[$__rate_interval])) / (sum(rate(tee_catalog_cache_total{result=~"hit|miss"}[$__rate_interval]))>0)',0,52,unit='percent',desc='Скользящее окно $__rate_interval. Пробелы означают отсутствие обращений к кэшу.')
panel(api,'Redis: запись в кэш',[(f'sum(rate(tee_catalog_cache_writes_total{{result="{result}"}}[$__rate_interval]))',label) for result,label in [('success','Успешно'),('error','Ошибка'),('skipped','Пропущено: ответ больше 2 МиБ')]],12,52,unit='ops',desc='Запись выполняется после загрузки данных из базы. Ошибки записи не мешают получить ответ, но приводят к повторным промахам.')
panel(api,'Redis: задержка чтения p50 / p95',[(f'histogram_quantile({q},sum by(le)(rate(tee_catalog_cache_read_seconds_bucket[$__rate_interval])))',name) for q,name in [(0.5,'p50'),(0.95,'p95')]],0,60,unit='s',desc='Включая создание соединения. Бюджет чтения — 150 мс; проверка версии каталога в PostgreSQL сюда не входит.')
panel(api,'Redis: ошибки записи за период','sum(increase(tee_catalog_cache_writes_total{result="error"}[$__range]))',12,60,6,4,'stat',thresholds=[{'color':'green','value':None},{'color':'red','value':1}])
status(api,'Redis: сбор INFO','tee_redis_info_up',18,60)
panel(api,'Redis: память',[('tee_redis_info{field="used_memory"}','Используется'),('tee_redis_info{field="maxmemory"}','Лимит')],0,68,unit='bytes',desc='Память всего Redis, включая служебные структуры. maxmemory=0 означает отсутствие лимита.')
panel(api,'Redis: занято от лимита, %','100*sum(tee_redis_info{field="used_memory"}) / (sum(tee_redis_info{field="maxmemory"})>0)',12,68,6,4,'stat','percent',desc='При отключённом лимите — нет данных.',thresholds=[{'color':'green','value':None},{'color':'orange','value':80},{'color':'red','value':95}])
panel(api,'Redis: ключей сейчас','tee_redis_info{field="keys"}',18,68,6,4,'stat',desc='Все ключи во всех базах Redis, включая предыдущие версии каталога до истечения TTL.')
panel(api,'Redis: удаления ключей',[('sum(rate(tee_redis_info{field="evicted_keys"}[$__rate_interval]))','Вытеснено по лимиту памяти'),('sum(rate(tee_redis_info{field="expired_keys"}[$__rate_interval]))','Истёк TTL')],0,76,unit='ops',desc='INFO содержит накопительные счётчики с момента запуска Redis; rate учитывает сбросы. Это метрики всего Redis.')
panel(api,'Redis: подключённых клиентов','tee_redis_info{field="connected_clients"}',12,76,unit='short',desc='Моментальный снимок INFO раз в 15 секунд, включая соединение мониторинга.')
note(api,'API-метрики исключают health-check и scrape из нагрузки по маршрутам. Счётчики перезапускаются вместе с API; rate/increase учитывают сбросы. Блок Redis не зависит от фильтра маршрутов: измеряется весь публичный кэш каталога (списки, страницы товаров, витрина). Hit означает ответ из Redis, а не полное отсутствие запросов в БД: версия каталога проверяется в PostgreSQL. После редактирования товаров кэш заполняется заново. TTL — 1 час; старые версии также могут вытесняться LRU. Повторное открытие одного раздела обычно увеличивает hit, первый запрос — miss. Приватные данные не кэшируются. INFO обновляется раз в 15 секунд; отсутствие данных при ошибке сбора не означает нулевую память.',84,5)
save(api,'api.json')
db=dashboard('tee-trade-postgres','FUTBA — здоровье PostgreSQL')
db['templating']['list']=[{'name':'database','label':'База','type':'query','datasource':DS,'query':'label_values(pg_database_size_bytes{datname!~"template.*|postgres"}, datname)','refresh':1,'multi':False,'includeAll':False}]
status(db,'PostgreSQL','pg_up',0,0)
status(db,'Exporter доступен','up{job="tee-trade-postgres"}',6,0)
panel(db,'Размер базы','pg_database_size_bytes{datname="$database"}',12,0,6,4,'stat','bytes')
panel(db,'Время работы PostgreSQL','time()-pg_postmaster_start_time_seconds',18,0,6,4,'stat','s')
panel(db,'Соединения базы','pg_stat_database_numbackends{datname="$database"}',0,4,6,4,'stat')
panel(db,'Лимит соединений сервера занят, %','100*sum(pg_stat_database_numbackends)/max(pg_settings_max_connections)',6,4,6,4,'stat','percent',thresholds=[{'color':'green','value':None},{'color':'orange','value':70},{'color':'red','value':90}])
panel(db,'Ошибки сбора PostgreSQL','pg_exporter_last_scrape_error',12,4,6,4,'stat',thresholds=[{'color':'green','value':None},{'color':'red','value':1}])
panel(db,'Deadlocks за диапазон','sum(increase(pg_stat_database_deadlocks{datname="$database"}[$__range]))',18,4,6,4,'stat',thresholds=[{'color':'green','value':None},{'color':'red','value':1}])
panel(db,'Подключения по состоянию','sum by(state)(pg_stat_activity_count{datname="$database"})',0,8)
panel(db,'Commit / rollback',[(f'sum(rate(pg_stat_database_xact_{n}{{datname="$database"}}[$__rate_interval]))',n) for n in ['commit','rollback']],12,8,unit='ops')
panel(db,'Доля попаданий в буфер PostgreSQL, %','100*sum(rate(pg_stat_database_blks_hit{datname="$database"}[$__rate_interval])) / (sum(rate(pg_stat_database_blks_hit{datname="$database"}[$__rate_interval]))+sum(rate(pg_stat_database_blks_read{datname="$database"}[$__rate_interval])))',0,16,unit='percent',desc='Только кеш PostgreSQL, не кеш ОС. При отсутствии чтений значения нет.')
panel(db,'Временные файлы — запись / сек','sum(rate(pg_stat_database_temp_bytes{datname="$database"}[$__rate_interval]))',12,16,unit='Bps')
panel(db,'Блокировки по типу','sum by(mode)(pg_locks_count{datname="$database"})',0,24,desc='Количество удерживаемых блокировок само по себе не означает ожидание.')
panel(db,'Максимальная длительность транзакции','max by(state)(pg_stat_activity_max_tx_duration{datname="$database"})',12,24,unit='s')
panel(db,'Размер таблиц — top 10','topk(10,pg_stat_user_tables_table_size_bytes{datname="$database"})',0,32,kind='bargauge',unit='bytes')
panel(db,'Мёртвые строки — top 10','topk(10,pg_stat_user_tables_n_dead_tup{datname="$database"})',12,32,kind='bargauge',desc='Оценка PostgreSQL; уменьшение зависит от vacuum.')
panel(db,'Изменения строк',[(f'sum(rate(pg_stat_database_tup_{n}{{datname="$database"}}[$__rate_interval]))',n) for n in ['inserted','updated','deleted']],0,40,unit='ops')
panel(db,'Autovacuum по таблицам','sum by(relname)(increase(pg_stat_user_tables_autovacuum_count{datname="$database"}[$__range]))',12,40,kind='bargauge')
note(db,'Метрики поступают от отдельного postgres-exporter внутри Docker. Здесь нет показателя свободного места на диске VPS: размер базы не равен свободному месту диска. pg_stat_* — накопительная статистика PostgreSQL; значения могут сбрасываться при перезапуске/сбросе статистики.',48)
save(db,'postgres.json')
biz=dashboard('tee-trade-business','FUTBA — бизнес и конверсии','now-7d')
biz['templating']['list']=[{'name':'window','label':'Окно показателей','type':'custom','query':'24h,7d,30d,90d','current':{'text':'7d','value':'7d'},'options':[{'text':w,'value':w,'selected':w=='7d'} for w in ['24h','7d','30d','90d']]}]
note(biz,'**Карточки показывают скользящее окно $window на текущий момент**, независимо от диапазона графиков в правом верхнем углу. Обновление данных — раз в минуту. Просмотр = открытие карточки; повторы одного посетителя и товара в одном 30-минутном интервале исключаются. Просмотры администратора и демотоваров из интерфейса не отправляются. Анонимные посетители определяются cookie, не являются точным числом людей.',0,4)
status(biz,'Сбор бизнес-данных','tee_business_collection_success',0,4)
panel(biz,'Возраст снимка','time()-tee_business_last_success_timestamp_seconds',6,4,6,4,'stat','s',thresholds=[{'color':'green','value':None},{'color':'orange','value':120},{'color':'red','value':180}])
panel(biz,'Просмотры собираются с','tee_views_start_timestamp_seconds*1000',12,4,12,4,'stat','dateTimeAsIso')
valid=' and on() (tee_business_collection_success == 1) and on() ((time()-tee_business_last_success_timestamp_seconds)<180)'
def event(n):return 'sum(tee_business_events{window="$window",event="'+n+'"})'
def stage(n):return 'sum(tee_business_funnel{window="$window",stage="'+n+'"})'
for i,(name,title) in enumerate([('registrations','Регистрации'),('views','Просмотры карточек'),('viewers','Посетители карточек'),('requests','Новые заявки'),('buyer_messages','Сообщения покупателей'),('admin_messages','Сообщения продавца'),('active_chats','Активные чаты'),('completed_requests','Завершённые заявки')]):
 panel(biz,title,event(name)+valid,(i%4)*6,8+(i//4)*4,6,4,'stat')
for i,(numer,denom,title) in enumerate([('view_to_request','view_pairs','Просмотр → заявка'),('message_to_request','message_pairs','Первое сообщение → заявка'),('view_to_chat','view_pairs','Просмотр → сообщение'),('registration_to_request','registered_customers','Регистрация → заявка')]):
 panel(biz,title,'100*'+stage(numer)+'/('+stage(denom)+'>0)'+valid,i*6,16,6,5,'stat','percent',desc='Конверсия в течение 7 дней. Для просмотров/сообщений единица — пара покупатель+товар; регистрация — покупатель. При пустой когорте нет данных. Недавние когорты ещё не успели завершить 7 дней.')
panel(biz,'Воронка авторизованных просмотров',[(stage(n)+valid,t) for n,t in [('view_pairs','Покупатель + товар'),('view_to_chat','Написали после просмотра'),('view_to_request','Оставили заявку после просмотра')]],0,21,kind='bargauge',desc='Сообщение не обязательно предшествует заявке; две независимые ветки после просмотра.')
panel(biz,'Воронка первых сообщений',[(stage(n)+valid,t) for n,t in [('message_pairs','Начали переписку'),('message_to_request','Оставили заявку после первого сообщения')]],12,21,kind='bargauge')
panel(biz,'Заявки сейчас — по статусу',[(f'sum(tee_requests_current{{status="{s}"}})'+valid,t) for s,t in [('new','Новые'),('in_progress','В работе'),('completed','Архив')]],0,29,kind='bargauge',desc='Все заявки, независимо от выбранного окна.')
panel(biz,'Самая старая новая заявка','tee_oldest_new_request_seconds'+valid,12,29,12,8,'stat','s')
panel(biz,'Просмотры за скользящее окно',[(event(n)+valid,t) for n,t in [('views_authenticated','Авторизованные'),('views_anonymous','Анонимные')]],0,37)
panel(biz,'Регистрации и заявки за скользящее окно',[(event(n)+valid,t) for n,t in [('registrations','Регистрации'),('requests','Заявки'),('request_customers','Покупатели с заявками')]],12,37)
panel(biz,'Сообщения за скользящее окно',[(event(n)+valid,t) for n,t in [('buyer_messages','Покупатели'),('admin_messages','Продавец')]],0,45)
panel(biz,'Конверсия переписок в заявки, %','100*'+stage('message_to_request')+'/('+stage('message_pairs')+'>0)'+valid,12,45,unit='percent')
note(biz,'**Методика:** просмотр → заявка: авторизованные пары покупатель+товар с первым просмотром в выбранном окне и заявкой после него в пределах 7 дней. Первое сообщение → заявка: пары с первым сообщением покупателя в окне, затем заявка в течение 7 дней. Регистрация → заявка: новые аккаунты с заявкой в течение 7 дней. Конверсии отражают последовательность событий, а не причинность. Анонимные просмотры не связываются задним числом с аккаунтом. Просмотры до внедрения не восстанавливаются; регистрации, заявки и сообщения доступны по сохранённым записям. Персональные данные не передаются в Prometheus.',53,5)
save(biz,'business.json')
print('Generated API, PostgreSQL and business dashboards')
