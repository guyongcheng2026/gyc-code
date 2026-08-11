-- ============================================================
-- 五E一中心数据架构 - 建表SQL（MySQL 8.0）
-- 基于《五E一中心数据架构设计》上/下篇
-- 命名: t_<中心>_<实体> | snake_case字段 | 主键 CHAR(32)
-- 说明: 本脚本为落地参考实现，按业务库拆分，可逐库执行
-- ============================================================

-- ========== 主数据层 db_mdm ==========
CREATE DATABASE IF NOT EXISTS db_mdm DEFAULT CHARSET utf8mb4;
USE db_mdm;

CREATE TABLE t_mdm_supplier (
  id CHAR(32) PRIMARY KEY,
  unified_code VARCHAR(18) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  short_name VARCHAR(100),
  legal_person VARCHAR(50),
  reg_capital DECIMAL(18,2),
  reg_date DATE,
  reg_address VARCHAR(300),
  biz_scope TEXT,
  industry_code VARCHAR(20),
  province_code VARCHAR(10),
  ca_cert_sn VARCHAR(100),
  ca_expire_date DATE,
  qual_level VARCHAR(10) DEFAULT 'C',
  credit_code VARCHAR(10),
  blacklist_flag TINYINT(1) DEFAULT 0,
  blacklist_reason VARCHAR(500),
  status VARCHAR(20) NOT NULL,
  source_system VARCHAR(20),
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  version INT DEFAULT 1,
  KEY idx_name (name),
  KEY idx_qual (qual_level),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mdm_material (
  id CHAR(32) PRIMARY KEY,
  material_code VARCHAR(30) NOT NULL UNIQUE,
  material_name VARCHAR(200) NOT NULL,
  spec_model VARCHAR(200),
  category_l1 VARCHAR(20),
  category_l2 VARCHAR(20),
  category_l3 VARCHAR(20),
  unit VARCHAR(10),
  material_type VARCHAR(20),
  tech_condition_no VARCHAR(50),
  brand_flag TINYINT(1) DEFAULT 0,
  hazardous_flag TINYINT(1) DEFAULT 0,
  shelf_life INT,
  standard_price DECIMAL(18,2),
  source_system VARCHAR(20),
  status VARCHAR(20) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_cat3 (category_l3),
  FULLTEXT idx_name (material_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mdm_organization (
  id CHAR(32) PRIMARY KEY,
  org_code VARCHAR(20) NOT NULL UNIQUE,
  org_name VARCHAR(200) NOT NULL,
  org_type VARCHAR(20),
  parent_id CHAR(32),
  province_code VARCHAR(10),
  level INT,
  manager_id CHAR(32),
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mdm_person (
  id CHAR(32) PRIMARY KEY,
  emp_code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(50) NOT NULL,
  id_card VARCHAR(18),
  org_id CHAR(32),
  position VARCHAR(50),
  phone VARCHAR(20),
  email VARCHAR(100),
  role_codes VARCHAR(200),
  ca_cert_sn VARCHAR(100),
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mdm_project (
  id CHAR(32) PRIMARY KEY,
  project_code VARCHAR(50) NOT NULL UNIQUE,
  project_name VARCHAR(300) NOT NULL,
  project_type VARCHAR(20),
  org_id CHAR(32),
  budget_total DECIMAL(18,2),
  start_date DATE,
  end_date DATE,
  wbs_root VARCHAR(50),
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== ECP db_ecp ==========
CREATE DATABASE IF NOT EXISTS db_ecp DEFAULT CHARSET utf8mb4;
USE db_ecp;

CREATE TABLE t_ecp_project (
  id CHAR(32) PRIMARY KEY,
  project_no VARCHAR(50) NOT NULL UNIQUE,
  project_name VARCHAR(300) NOT NULL,
  purchase_type VARCHAR(20) NOT NULL,
  purchase_mode VARCHAR(20),
  org_id CHAR(32),
  budget_amount DECIMAL(18,2),
  currency VARCHAR(3) DEFAULT 'CNY',
  tech_book_no VARCHAR(50),
  bid_open_date DATETIME,
  bid_open_addr VARCHAR(300),
  package_count INT,
  evaluate_method VARCHAR(20),
  agency_id CHAR(32),
  status VARCHAR(20) NOT NULL,
  create_by CHAR(32),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_type (purchase_type),
  KEY idx_status (status),
  KEY idx_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_package (
  id CHAR(32) PRIMARY KEY,
  project_id CHAR(32),
  package_no VARCHAR(20),
  package_name VARCHAR(200),
  material_codes TEXT,
  estimate_amount DECIMAL(18,2),
  supplier_qual_req TEXT,
  tech_req TEXT,
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_proj (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_notice (
  id CHAR(32) PRIMARY KEY,
  project_id CHAR(32),
  notice_type VARCHAR(20),
  title VARCHAR(300) NOT NULL,
  content LONGTEXT,
  publish_date DATETIME,
  end_bid_date DATETIME,
  file_url VARCHAR(500),
  view_count INT DEFAULT 0,
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_proj (project_id),
  KEY idx_type (notice_type),
  KEY idx_pub (publish_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_bid (
  id CHAR(32) PRIMARY KEY,
  project_id CHAR(32),
  package_id CHAR(32),
  supplier_id CHAR(32),
  bid_file_url VARCHAR(500),
  bid_file_hash VARCHAR(100),
  bid_amount DECIMAL(18,2),
  bid_date DATETIME,
  decrypt_status VARCHAR(20) DEFAULT 'PENDING',
  evaluate_score DECIMAL(10,2),
  rank_no INT,
  is_winner TINYINT(1) DEFAULT 0,
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_proj_pkg (project_id, package_id),
  KEY idx_sup (supplier_id),
  KEY idx_winner (is_winner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_expert_draw (
  id CHAR(32) PRIMARY KEY,
  project_id CHAR(32),
  package_id CHAR(32),
  expert_id CHAR(32),
  draw_time DATETIME,
  avoid_reason VARCHAR(200),
  confirm_status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_proj (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_contract (
  id CHAR(32) PRIMARY KEY,
  contract_no VARCHAR(50) NOT NULL UNIQUE,
  project_id CHAR(32),
  package_id CHAR(32),
  supplier_id CHAR(32),
  contract_name VARCHAR(300) NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'CNY',
  sign_date DATE,
  effective_date DATE,
  delivery_date DATE,
  contract_type VARCHAR(20),
  payment_terms VARCHAR(200),
  framework_flag TINYINT(1) DEFAULT 0,
  framework_valid_from DATE,
  framework_valid_to DATE,
  file_url VARCHAR(500),
  ca_sign_supplier VARCHAR(100),
  ca_sign_buyer VARCHAR(100),
  status VARCHAR(20) NOT NULL,
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_sup (supplier_id),
  KEY idx_status (status),
  KEY idx_fw (framework_flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_contract_exec (
  id CHAR(32) PRIMARY KEY,
  contract_id CHAR(32),
  node_type VARCHAR(20),
  plan_date DATE,
  actual_date DATE,
  progress DECIMAL(5,2),
  remark VARCHAR(500),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_supplier_eval (
  id CHAR(32) PRIMARY KEY,
  supplier_id CHAR(32),
  eval_period VARCHAR(10),
  delivery_score DECIMAL(5,2),
  quality_score DECIMAL(5,2),
  service_score DECIMAL(5,2),
  price_score DECIMAL(5,2),
  hse_score DECIMAL(5,2),
  total_score DECIMAL(5,2),
  grade VARCHAR(10),
  eval_by CHAR(32),
  created_at DATETIME,
  updated_at DATETIME,
  UNIQUE KEY uk_sup_period (supplier_id, eval_period),
  KEY idx_sup (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== EIP db_eip ==========
CREATE DATABASE IF NOT EXISTS db_eip DEFAULT CHARSET utf8mb4;
USE db_eip;

CREATE TABLE t_eip_manufacturer (
  id CHAR(32) PRIMARY KEY,
  supplier_id CHAR(32),
  unified_code VARCHAR(18),
  name VARCHAR(200) NOT NULL,
  province_code VARCHAR(10),
  product_categories VARCHAR(500),
  gateway_count INT DEFAULT 0,
  access_date DATE,
  access_status VARCHAR(20),
  quality_grade VARCHAR(10),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_sup (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_eip_production_line (
  id CHAR(32) PRIMARY KEY,
  manufacturer_id CHAR(32),
  line_code VARCHAR(50) NOT NULL UNIQUE,
  line_name VARCHAR(100),
  product_types VARCHAR(200),
  gateway_id CHAR(32),
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_mfr (manufacturer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_eip_gateway (
  id CHAR(32) PRIMARY KEY,
  gateway_sn VARCHAR(50) NOT NULL UNIQUE,
  manufacturer_id CHAR(32),
  model VARCHAR(50),
  firmware_version VARCHAR(20),
  protocol_list VARCHAR(200),
  network_status VARCHAR(20),
  last_heartbeat DATETIME,
  cert_sn VARCHAR(100),
  install_addr VARCHAR(300),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_sn (gateway_sn),
  KEY idx_net (network_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_eip_production_order (
  id CHAR(32) PRIMARY KEY,
  order_no VARCHAR(50) NOT NULL UNIQUE,
  ecp_order_no VARCHAR(50),
  manufacturer_id CHAR(32),
  material_code VARCHAR(30),
  product_name VARCHAR(200),
  quantity INT,
  tech_book_no VARCHAR(50),
  plan_start DATETIME,
  plan_finish DATETIME,
  actual_start DATETIME,
  actual_finish DATETIME,
  current_node VARCHAR(20),
  quality_status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_order (order_no),
  KEY idx_ecp (ecp_order_no),
  KEY idx_mfr (manufacturer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_eip_quality_test (
  id CHAR(32) PRIMARY KEY,
  production_order_id CHAR(32),
  product_serial VARCHAR(100),
  test_item_code VARCHAR(50),
  test_item_name VARCHAR(100),
  test_value DECIMAL(18,4),
  unit VARCHAR(20),
  lower_limit DECIMAL(18,4),
  upper_limit DECIMAL(18,4),
  result VARCHAR(10),
  test_time DATETIME,
  test_device_id VARCHAR(50),
  operator VARCHAR(50),
  report_url VARCHAR(500),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_po (production_order_id),
  KEY idx_result (result),
  KEY idx_time (test_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY RANGE (TO_DAYS(test_time)) (
  PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
  PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);

CREATE TABLE t_eip_material_batch (
  id CHAR(32) PRIMARY KEY,
  production_order_id CHAR(32),
  batch_no VARCHAR(50),
  material_name VARCHAR(200),
  supplier_name VARCHAR(200),
  inbound_check VARCHAR(10),
  check_report_url VARCHAR(500),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_po (production_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== ERP db_erp ==========
CREATE DATABASE IF NOT EXISTS db_erp DEFAULT CHARSET utf8mb4;
USE db_erp;

CREATE TABLE t_erp_po (
  id CHAR(32) PRIMARY KEY,
  po_no VARCHAR(50) NOT NULL UNIQUE,
  ecp_contract_no VARCHAR(50),
  supplier_id CHAR(32),
  org_id CHAR(32),
  po_type VARCHAR(10),
  total_amount DECIMAL(18,2),
  currency VARCHAR(3),
  plant VARCHAR(10),
  status VARCHAR(20),
  grir_status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_po (po_no),
  KEY idx_ecp (ecp_contract_no),
  KEY idx_sup (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_erp_po_item (
  id CHAR(32) PRIMARY KEY,
  po_id CHAR(32),
  line_no INT,
  material_code VARCHAR(30),
  material_desc VARCHAR(200),
  quantity DECIMAL(10,3),
  unit VARCHAR(10),
  unit_price DECIMAL(18,2),
  delivery_date DATE,
  plant VARCHAR(10),
  storage_loc VARCHAR(10),
  gr_quantity DECIMAL(10,3) DEFAULT 0,
  iv_quantity DECIMAL(10,3) DEFAULT 0,
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_erp_gr (
  id CHAR(32) PRIMARY KEY,
  gr_no VARCHAR(50) NOT NULL UNIQUE,
  po_id CHAR(32),
  po_item_id CHAR(32),
  material_code VARCHAR(30),
  quantity DECIMAL(10,3),
  move_type VARCHAR(3),
  plant VARCHAR(10),
  storage_loc VARCHAR(10),
  post_date DATETIME,
  qc_status VARCHAR(20) DEFAULT 'PENDING',
  ecp_order_no VARCHAR(50),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_po (po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_erp_invoice (
  id CHAR(32) PRIMARY KEY,
  invoice_no VARCHAR(50) NOT NULL UNIQUE,
  po_id CHAR(32),
  supplier_id CHAR(32),
  invoice_amount DECIMAL(18,2),
  tax_amount DECIMAL(18,2),
  gr_ir_clear TINYINT(1) DEFAULT 0,
  verify_status VARCHAR(20),
  payment_status VARCHAR(20) DEFAULT 'UNPAID',
  ecp_contract_no VARCHAR(50),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_po (po_id),
  KEY idx_sup (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_erp_storage_loc (
  id CHAR(32) PRIMARY KEY,
  storage_loc_code VARCHAR(10) NOT NULL UNIQUE,
  plant_code VARCHAR(10),
  loc_name VARCHAR(100),
  loc_type VARCHAR(20),
  manager_id CHAR(32),
  created_at DATETIME,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_erp_stock (
  id CHAR(32) PRIMARY KEY,
  material_code VARCHAR(30),
  plant VARCHAR(10),
  storage_loc VARCHAR(10),
  batch_no VARCHAR(50),
  stock_qty DECIMAL(10,3) DEFAULT 0,
  stock_type VARCHAR(20),
  val_price DECIMAL(18,2),
  last_move_date DATETIME,
  created_at DATETIME,
  updated_at DATETIME,
  UNIQUE KEY uk_stock (material_code, plant, storage_loc, batch_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_erp_fi_doc (
  id CHAR(32) PRIMARY KEY,
  fi_doc_no VARCHAR(50) NOT NULL UNIQUE,
  doc_type VARCHAR(10),
  posting_date DATE,
  fiscal_year INT,
  company_code VARCHAR(10),
  amount DECIMAL(18,2),
  debit_credit VARCHAR(1),
  gl_account VARCHAR(20),
  vendor_id CHAR(32),
  reference VARCHAR(50),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_vendor (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_erp_wbs (
  id CHAR(32) PRIMARY KEY,
  wbs_element VARCHAR(50) NOT NULL UNIQUE,
  project_id CHAR(32),
  wbs_name VARCHAR(200),
  parent_wbs VARCHAR(50),
  budget DECIMAL(18,2),
  actual_cost DECIMAL(18,2) DEFAULT 0,
  start_date DATE,
  end_date DATE,
  status VARCHAR(20),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_proj (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== ELP db_elp ==========
CREATE DATABASE IF NOT EXISTS db_elp DEFAULT CHARSET utf8mb4;
USE db_elp;

CREATE TABLE t_elp_shipment (
  id CHAR(32) PRIMARY KEY,
  shipment_no VARCHAR(50) NOT NULL UNIQUE,
  ecp_order_no VARCHAR(50),
  supplier_id CHAR(32),
  from_warehouse VARCHAR(50),
  to_location VARCHAR(300),
  contact_person VARCHAR(50),
  contact_phone VARCHAR(20),
  planned_departure DATETIME,
  planned_arrival DATETIME,
  actual_departure DATETIME,
  actual_arrival DATETIME,
  vehicle_id CHAR(32),
  driver_id CHAR(32),
  cargo_type VARCHAR(20),
  total_weight DECIMAL(10,2),
  status VARCHAR(20),
  estimated_cost DECIMAL(10,2),
  actual_cost DECIMAL(10,2),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_ship (shipment_no),
  KEY idx_ecp (ecp_order_no),
  KEY idx_status (status),
  KEY idx_veh (vehicle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_elp_vehicle (
  id CHAR(32) PRIMARY KEY,
  plate_no VARCHAR(20) NOT NULL UNIQUE,
  vehicle_type VARCHAR(20),
  capacity_ton DECIMAL(8,2),
  gps_device_id VARCHAR(50),
  insurance_no VARCHAR(50),
  insurance_expire DATE,
  status VARCHAR(20),
  carrier_id CHAR(32),
  created_at DATETIME,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_elp_gps_track (
  id CHAR(32) PRIMARY KEY,
  shipment_id CHAR(32),
  timestamp DATETIME NOT NULL,
  latitude DECIMAL(10,6),
  longitude DECIMAL(10,6),
  speed DECIMAL(5,2),
  direction DECIMAL(5,2),
  vibration DECIMAL(5,2),
  temperature DECIMAL(5,2),
  humidity DECIMAL(5,2),
  fence_status VARCHAR(10),
  battery_level INT,
  created_at DATETIME,
  KEY idx_ship_time (shipment_id, timestamp),
  KEY idx_time (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY RANGE (TO_DAYS(timestamp)) (
  PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
  PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);

CREATE TABLE t_elp_warehouse_stock (
  id CHAR(32) PRIMARY KEY,
  warehouse_code VARCHAR(20),
  material_code VARCHAR(30),
  batch_no VARCHAR(50),
  quantity DECIMAL(10,3),
  stock_type VARCHAR(20),
  location_code VARCHAR(20),
  inbound_date DATE,
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_wh (warehouse_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_elp_warehouse (
  id CHAR(32) PRIMARY KEY,
  warehouse_code VARCHAR(20) NOT NULL UNIQUE,
  warehouse_name VARCHAR(100),
  warehouse_level VARCHAR(10),
  province_code VARCHAR(10),
  addr VARCHAR(300),
  capacity_area DECIMAL(10,2),
  manager_id CHAR(32),
  created_at DATETIME,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== e物资 db_emobile ==========
CREATE DATABASE IF NOT EXISTS db_emobile DEFAULT CHARSET utf8mb4;
USE db_emobile;

CREATE TABLE t_emobile_op_log (
  id CHAR(32) PRIMARY KEY,
  user_id CHAR(32),
  op_type VARCHAR(20) NOT NULL,
  biz_order_no VARCHAR(50),
  material_code VARCHAR(30),
  quantity DECIMAL(10,3),
  photo_url VARCHAR(500),
  gps_lat DECIMAL(10,6),
  gps_lng DECIMAL(10,6),
  sign_data VARCHAR(500),
  local_time DATETIME,
  sync_status VARCHAR(10) DEFAULT 'PENDING',
  sync_time DATETIME,
  device_id VARCHAR(50),
  version INT DEFAULT 1,
  created_at DATETIME,
  updated_at DATETIME,
  UNIQUE KEY uk_id (id),
  KEY idx_user (user_id),
  KEY idx_sync (sync_status),
  KEY idx_biz (biz_order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_emobile_offline_queue (
  id CHAR(32) PRIMARY KEY,
  op_log_id CHAR(32),
  payload MEDIUMTEXT,
  target_service VARCHAR(50),
  retry_count INT DEFAULT 0,
  next_retry DATETIME,
  status VARCHAR(10) DEFAULT 'QUEUED',
  error_msg VARCHAR(500),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_op (op_log_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_emobile_device (
  id CHAR(32) PRIMARY KEY,
  device_id VARCHAR(50) NOT NULL UNIQUE,
  user_id CHAR(32),
  device_model VARCHAR(50),
  os_version VARCHAR(20),
  app_version VARCHAR(20),
  last_active DATETIME,
  push_token VARCHAR(200),
  status VARCHAR(10),
  created_at DATETIME,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_emobile_scan_log (
  id CHAR(32) PRIMARY KEY,
  user_id CHAR(32),
  scan_type VARCHAR(20),
  scan_value VARCHAR(100),
  biz_context VARCHAR(100),
  scan_time DATETIME,
  device_id VARCHAR(50),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== ESC db_esc ==========
CREATE DATABASE IF NOT EXISTS db_esc DEFAULT CHARSET utf8mb4;
USE db_esc;

CREATE TABLE t_esc_data_ingest (
  id CHAR(32) PRIMARY KEY,
  source_system VARCHAR(20),
  data_type VARCHAR(50),
  record_count INT,
  ingest_mode VARCHAR(20),
  status VARCHAR(20),
  error_msg VARCHAR(500),
  batch_id VARCHAR(50),
  created_at DATETIME,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_esc_supplier_risk (
  id CHAR(32) PRIMARY KEY,
  supplier_id CHAR(32),
  risk_type VARCHAR(20),
  risk_level VARCHAR(10),
  risk_score DECIMAL(5,2),
  trigger_source VARCHAR(50),
  detail TEXT,
  handle_status VARCHAR(20) DEFAULT 'OPEN',
  handle_by CHAR(32),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_sup_type (supplier_id, risk_type),
  KEY idx_level (risk_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_esc_purchase_kpi (
  id CHAR(32) PRIMARY KEY,
  stat_date DATE NOT NULL,
  org_id CHAR(32),
  province_code VARCHAR(10),
  purchase_amount DECIMAL(18,2),
  contract_count INT,
  supplier_count INT,
  save_amount DECIMAL(18,2),
  ontime_rate DECIMAL(5,2),
  qualify_rate DECIMAL(5,2),
  avg_cycle_days DECIMAL(5,2),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_date_org (stat_date, org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_esc_supplier_profile (
  id CHAR(32) PRIMARY KEY,
  supplier_id CHAR(32) NOT NULL UNIQUE,
  total_contract_amount DECIMAL(18,2),
  total_contract_count INT,
  avg_delivery_score DECIMAL(5,2),
  avg_quality_score DECIMAL(5,2),
  avg_price_score DECIMAL(5,2),
  lawsuit_count INT,
  negative_news_count INT,
  cooperation_years INT,
  profile_tags VARCHAR(500),
  risk_level VARCHAR(10),
  last_calc_time DATETIME,
  created_at DATETIME,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_esc_alert_event (
  id CHAR(32) PRIMARY KEY,
  alert_type VARCHAR(20),
  source_system VARCHAR(20),
  ref_id VARCHAR(50),
  alert_level VARCHAR(10),
  title VARCHAR(200),
  content TEXT,
  notify_channels VARCHAR(100),
  handle_status VARCHAR(20) DEFAULT 'UNREAD',
  handle_by CHAR(32),
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_type_level (alert_type, alert_level),
  KEY idx_status (handle_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_esc_report (
  id CHAR(32) PRIMARY KEY,
  report_type VARCHAR(20),
  title VARCHAR(300),
  period_start DATE,
  period_end DATE,
  content LONGTEXT,
  generator VARCHAR(20),
  ai_model VARCHAR(50),
  approve_status VARCHAR(20) DEFAULT 'DRAFT',
  created_by CHAR(32),
  created_at DATETIME,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== 集成层 db_intf ==========
CREATE DATABASE IF NOT EXISTS db_intf DEFAULT CHARSET utf8mb4;
USE db_intf;

CREATE TABLE t_intf_log (
  id CHAR(32) PRIMARY KEY,
  interface_id VARCHAR(50),
  source_system VARCHAR(20),
  target_system VARCHAR(20),
  req_msg_id VARCHAR(50),
  req_body MEDIUMTEXT,
  resp_body MEDIUMTEXT,
  status VARCHAR(20),
  duration_ms INT,
  error_code VARCHAR(20),
  created_at DATETIME,
  UNIQUE KEY uk_intf_msg (interface_id, req_msg_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY RANGE (TO_DAYS(created_at)) (
  PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
  PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);

CREATE TABLE t_intf_mdm_dist (
  id CHAR(32) PRIMARY KEY,
  mdm_type VARCHAR(20),
  mdm_id CHAR(32),
  target_system VARCHAR(20),
  action VARCHAR(10),
  dist_status VARCHAR(20) DEFAULT 'PENDING',
  retry_count INT DEFAULT 0,
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_mdm (mdm_type, mdm_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_intf_sync_state (
  id CHAR(32) PRIMARY KEY,
  biz_type VARCHAR(50),
  biz_id VARCHAR(50),
  source_system VARCHAR(20),
  target_system VARCHAR(20),
  sync_status VARCHAR(20),
  last_sync_time DATETIME,
  version INT,
  created_at DATETIME,
  updated_at DATETIME,
  KEY idx_biz (biz_type, biz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_intf_idoc_map (
  id CHAR(32) PRIMARY KEY,
  idoc_type VARCHAR(20),
  direction VARCHAR(10),
  target_table VARCHAR(50),
  field_mapping MEDIUMTEXT,
  transform_script TEXT,
  created_at DATETIME,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 建表完成。共 10 个业务库、74张业务表（分析层DIM/FACT/KPI/ADS
-- 建议基于ClickHouse/Hudi单独建库，此处略）。
-- ============================================================
