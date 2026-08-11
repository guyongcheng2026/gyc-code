-- ============================================================
-- 国网ECP（交易域 + 商城电商域）建表SQL — 细化版 v2
-- 在v1(38表)基础上：新增20表(E1~E10, M1~M10) + 关键字段ALTER
-- MySQL 8.0 | utf8mb4 | InnoDB | 命名 t_ecp_* / t_mall_* / t_mdm_*
-- 共 63张表，覆盖招投标法强制流程 + 等保2.0三级 + B2B计税开票 + ERP集成
-- ============================================================

CREATE DATABASE IF NOT EXISTS db_ecp DEFAULT CHARSET utf8mb4;
USE db_ecp;

-- ========== MDM 主数据层（5表，保持不变） ==========
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
  KEY idx_name (name), KEY idx_qual (qual_level), KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mdm_material (
  id CHAR(32) PRIMARY KEY,
  material_code VARCHAR(30) NOT NULL UNIQUE,
  material_name VARCHAR(200) NOT NULL,
  spec_model VARCHAR(200),
  category_l1 VARCHAR(20), category_l2 VARCHAR(20), category_l3 VARCHAR(20),
  unit VARCHAR(10), material_type VARCHAR(20),
  tech_condition_no VARCHAR(50),
  brand_flag TINYINT(1) DEFAULT 0, hazardous_flag TINYINT(1) DEFAULT 0,
  shelf_life INT, standard_price DECIMAL(18,2),
  source_system VARCHAR(20), status VARCHAR(20) NOT NULL,
  created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
  KEY idx_cat3 (category_l3), FULLTEXT idx_name (material_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mdm_organization (
  id CHAR(32) PRIMARY KEY,
  org_code VARCHAR(20) NOT NULL UNIQUE, org_name VARCHAR(200) NOT NULL,
  org_type VARCHAR(20), parent_id CHAR(32), province_code VARCHAR(10),
  level INT, manager_id CHAR(32), status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mdm_person (
  id CHAR(32) PRIMARY KEY,
  emp_code VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(50) NOT NULL,
  id_card VARCHAR(18), org_id CHAR(32), position VARCHAR(50),
  phone VARCHAR(20), email VARCHAR(100), role_codes VARCHAR(200),
  ca_cert_sn VARCHAR(100), status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mdm_project (
  id CHAR(32) PRIMARY KEY,
  project_code VARCHAR(50) NOT NULL UNIQUE, project_name VARCHAR(300) NOT NULL,
  project_type VARCHAR(20), org_id CHAR(32), budget_total DECIMAL(18,2),
  start_date DATE, end_date DATE, wbs_root VARCHAR(50), status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== ECP 交易域（v1 15表，保持不变） ==========
CREATE TABLE t_ecp_purchase_req (
  id CHAR(32) PRIMARY KEY, req_no VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(300) NOT NULL, apply_org_id CHAR(32), apply_user_id CHAR(32),
  budget_amount DECIMAL(18,2), budget_source VARCHAR(50),
  purchase_type VARCHAR(20) NOT NULL, urgency VARCHAR(10) DEFAULT 'NORMAL',
  reason TEXT, project_id CHAR(32), status VARCHAR(20) NOT NULL,
  approve_flow_id CHAR(32), created_at DATETIME, updated_at DATETIME,
  KEY idx_org (apply_org_id), KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_purchase_plan (
  id CHAR(32) PRIMARY KEY, plan_no VARCHAR(50) NOT NULL UNIQUE,
  req_id CHAR(32), title VARCHAR(300) NOT NULL, org_id CHAR(32),
  purchase_type VARCHAR(20) NOT NULL, estimate_amount DECIMAL(18,2),
  package_strategy TEXT, evaluate_method VARCHAR(20), scoring_rule MEDIUMTEXT,
  agency_flag TINYINT(1) DEFAULT 0, agency_id CHAR(32), tech_book_no VARCHAR(50),
  plan_begin DATE, plan_end DATE, status VARCHAR(20) NOT NULL,
  created_at DATETIME, updated_at DATETIME,
  KEY idx_req (req_id), KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_project (
  id CHAR(32) PRIMARY KEY, project_no VARCHAR(50) NOT NULL UNIQUE,
  project_name VARCHAR(300) NOT NULL, plan_id CHAR(32),
  purchase_type VARCHAR(20) NOT NULL, purchase_mode VARCHAR(20),
  org_id CHAR(32), budget_amount DECIMAL(18,2), currency VARCHAR(3) DEFAULT 'CNY',
  tech_book_no VARCHAR(50), bid_open_date DATETIME, bid_open_addr VARCHAR(300),
  bid_open_mode VARCHAR(20) DEFAULT 'ONLINE', package_count INT,
  evaluate_method VARCHAR(20), agency_id CHAR(32), open_flag TINYINT(1) DEFAULT 0,
  status VARCHAR(20) NOT NULL, create_by CHAR(32),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_type (purchase_type), KEY idx_status (status), KEY idx_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_package (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), package_no VARCHAR(20),
  package_name VARCHAR(200), material_codes TEXT, estimate_amount DECIMAL(18,2),
  supplier_qual_req TEXT, tech_req TEXT, bidder_limit INT, status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_proj (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_clarification (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), package_id CHAR(32),
  ask_user_id CHAR(32), ask_content TEXT NOT NULL, ask_time DATETIME,
  answer_content TEXT, answer_user_id CHAR(32), answer_time DATETIME,
  is_public TINYINT(1) DEFAULT 1, status VARCHAR(20) DEFAULT 'PENDING',
  created_at DATETIME, updated_at DATETIME,
  KEY idx_proj (project_id), KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_notice (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), notice_type VARCHAR(20),
  title VARCHAR(300) NOT NULL, content LONGTEXT, publish_date DATETIME,
  end_bid_date DATETIME, file_url VARCHAR(500), file_hash VARCHAR(100),
  view_count INT DEFAULT 0, download_count INT DEFAULT 0, status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_proj (project_id), KEY idx_type (notice_type), KEY idx_pub (publish_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_bid (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), package_id CHAR(32),
  supplier_id CHAR(32), bid_file_url VARCHAR(500), bid_file_hash VARCHAR(100),
  bid_amount DECIMAL(18,2), bid_detail MEDIUMTEXT, bid_date DATETIME,
  bid_tool_version VARCHAR(20), decrypt_status VARCHAR(20) DEFAULT 'PENDING',
  decrypt_time DATETIME, evaluate_score DECIMAL(10,2), price_score DECIMAL(10,2),
  tech_score DECIMAL(10,2), biz_score DECIMAL(10,2), rank_no INT,
  is_winner TINYINT(1) DEFAULT 0, reject_reason VARCHAR(500), status VARCHAR(20),
  tech_bid_url VARCHAR(500), biz_bid_url VARCHAR(500), bid_file_name VARCHAR(200),
  late_flag TINYINT(1) DEFAULT 0, withdraw_status VARCHAR(20), encrypt_algo VARCHAR(20) DEFAULT 'SM4',
  created_at DATETIME, updated_at DATETIME,
  KEY idx_proj_pkg (project_id, package_id), KEY idx_sup (supplier_id), KEY idx_winner (is_winner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_bid_bond (
  id CHAR(32) PRIMARY KEY, bid_id CHAR(32), supplier_id CHAR(32),
  bond_amount DECIMAL(18,2), bond_type VARCHAR(20), pay_status VARCHAR(20) DEFAULT 'UNPAID',
  pay_time DATETIME, pay_cert_url VARCHAR(500), refund_status VARCHAR(20) DEFAULT 'NONE',
  refund_time DATETIME, created_at DATETIME, updated_at DATETIME,
  KEY idx_bid (bid_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_expert_draw (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), package_id CHAR(32),
  expert_id CHAR(32), expert_cat VARCHAR(20), draw_time DATETIME,
  avoid_reason VARCHAR(200), confirm_status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_proj (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_evaluation (
  id CHAR(32) PRIMARY KEY, bid_id CHAR(32), expert_id CHAR(32), package_id CHAR(32),
  tech_score DECIMAL(10,2), biz_score DECIMAL(10,2), price_score DECIMAL(10,2),
  total_score DECIMAL(10,2), comment TEXT, submit_time DATETIME,
  created_at DATETIME, updated_at DATETIME,
  UNIQUE KEY uk_bid_exp (bid_id, expert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_award (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), package_id CHAR(32), bid_id CHAR(32),
  supplier_id CHAR(32), award_amount DECIMAL(18,2), rank_no INT, award_reason TEXT,
  public_flag TINYINT(1) DEFAULT 1, status VARCHAR(20), approve_by CHAR(32),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_proj_pkg (project_id, package_id), KEY idx_sup (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_contract (
  id CHAR(32) PRIMARY KEY, contract_no VARCHAR(50) NOT NULL UNIQUE,
  project_id CHAR(32), package_id CHAR(32), award_id CHAR(32), supplier_id CHAR(32),
  contract_name VARCHAR(300) NOT NULL, total_amount DECIMAL(18,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'CNY', sign_date DATE, effective_date DATE,
  delivery_date DATE, contract_type VARCHAR(20), payment_terms VARCHAR(200),
  framework_flag TINYINT(1) DEFAULT 0, framework_valid_from DATE, framework_valid_to DATE,
  file_url VARCHAR(500), ca_sign_supplier VARCHAR(100), ca_sign_buyer VARCHAR(100),
  status VARCHAR(20) NOT NULL,
  erp_po_no VARCHAR(50), parent_contract_id CHAR(32), contract_pdf_hash VARCHAR(100),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_sup (supplier_id), KEY idx_status (status), KEY idx_fw (framework_flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_contract_exec (
  id CHAR(32) PRIMARY KEY, contract_id CHAR(32), node_type VARCHAR(20),
  plan_date DATE, actual_date DATE, progress DECIMAL(5,2), remark VARCHAR(500),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_mall_order (
  id CHAR(32) PRIMARY KEY, order_no VARCHAR(50) NOT NULL UNIQUE, contract_id CHAR(32),
  supplier_id CHAR(32), org_id CHAR(32), total_amount DECIMAL(18,2),
  currency VARCHAR(3) DEFAULT 'CNY', delivery_addr VARCHAR(300), expect_date DATE,
  approve_status VARCHAR(20) DEFAULT 'PENDING', order_status VARCHAR(20),
  created_by CHAR(32), created_at DATETIME, updated_at DATETIME,
  KEY idx_order (order_no), KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_supplier_eval (
  id CHAR(32) PRIMARY KEY, supplier_id CHAR(32), eval_period VARCHAR(10),
  delivery_score DECIMAL(5,2), quality_score DECIMAL(5,2), service_score DECIMAL(5,2),
  price_score DECIMAL(5,2), hse_score DECIMAL(5,2), total_score DECIMAL(5,2),
  grade VARCHAR(10), eval_by CHAR(32), created_at DATETIME, updated_at DATETIME,
  UNIQUE KEY uk_sup_period (supplier_id, eval_period), KEY idx_sup (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== ECP 交易域 新增10表 (E1~E10) ==========
CREATE TABLE t_ecp_package_item (
  id CHAR(32) PRIMARY KEY, package_id CHAR(32), material_code VARCHAR(30),
  material_name VARCHAR(200), spec_model VARCHAR(200), quantity DECIMAL(10,3) NOT NULL,
  unit VARCHAR(10), estimate_price DECIMAL(18,2), estimate_amount DECIMAL(18,2),
  remark VARCHAR(500), created_at DATETIME, updated_at DATETIME,
  KEY idx_pkg (package_id), KEY idx_mat (material_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_bid_qualification (
  id CHAR(32) PRIMARY KEY, bid_id CHAR(32), qual_type VARCHAR(30),
  file_name VARCHAR(200), file_url VARCHAR(500), file_hash VARCHAR(100),
  upload_time DATETIME, status VARCHAR(20), created_at DATETIME, updated_at DATETIME,
  KEY idx_bid (bid_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_eval_template (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), package_id CHAR(32),
  template_name VARCHAR(100), dimensions MEDIUMTEXT, status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_pkg (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_eval_committee (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), package_id CHAR(32),
  expert_id CHAR(32), role VARCHAR(20), confirm_status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_pkg (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_complaint (
  id CHAR(32) PRIMARY KEY, project_id CHAR(32), package_id CHAR(32),
  complainant_id CHAR(32), complainant_type VARCHAR(20), complaint_type VARCHAR(20),
  content TEXT NOT NULL, submit_time DATETIME, handle_status VARCHAR(20) DEFAULT 'PENDING',
  handle_by CHAR(32), handle_result TEXT, handle_time DATETIME,
  created_at DATETIME, updated_at DATETIME,
  KEY idx_proj (project_id), KEY idx_status (handle_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_framework_catalog (
  id CHAR(32) PRIMARY KEY, contract_id CHAR(32), material_code VARCHAR(30),
  material_name VARCHAR(200), spec_model VARCHAR(200), unit VARCHAR(10),
  price_ceiling DECIMAL(18,2), moq INT, lead_time INT, valid_from DATE,
  valid_to DATE, status VARCHAR(20), created_at DATETIME, updated_at DATETIME,
  KEY idx_contract (contract_id), KEY idx_mat (material_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_contract_payment (
  id CHAR(32) PRIMARY KEY, contract_id CHAR(32), seq INT, payment_type VARCHAR(20),
  plan_amount DECIMAL(18,2), plan_date DATE, actual_amount DECIMAL(18,2),
  actual_date DATETIME, pay_status VARCHAR(20) DEFAULT 'UNPAID', invoice_no VARCHAR(50),
  erp_fi_no VARCHAR(50), created_at DATETIME, updated_at DATETIME,
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_contract_change (
  id CHAR(32) PRIMARY KEY, contract_id CHAR(32), change_type VARCHAR(20),
  change_reason TEXT, change_amount DECIMAL(18,2), change_content TEXT,
  approve_status VARCHAR(20) DEFAULT 'PENDING', approved_by CHAR(32),
  change_date DATE, created_at DATETIME, updated_at DATETIME,
  KEY idx_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_ecp_audit_log (
  id CHAR(32) PRIMARY KEY, biz_module VARCHAR(30), biz_id CHAR(32),
  action VARCHAR(30), operator_id CHAR(32), operator_ip VARCHAR(50),
  detail MEDIUMTEXT, result VARCHAR(20), created_at DATETIME, updated_at DATETIME,
  KEY idx_biz (biz_module, biz_id), KEY idx_operator (operator_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY RANGE (TO_DAYS(created_at)) (
  PARTITION p202601 VALUES LESS THAN (TO_DAYS('2026-02-01')),
  PARTITION p202602 VALUES LESS THAN (TO_DAYS('2026-03-01')),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);

CREATE TABLE t_ecp_approval_log (
  id CHAR(32) PRIMARY KEY, flow_type VARCHAR(30), biz_id CHAR(32), node_no INT,
  node_name VARCHAR(50), approver_id CHAR(32), approve_action VARCHAR(20),
  approve_comment TEXT, approve_time DATETIME, status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_flow (flow_type, biz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== 国网商城 电商域（v1 18表，加细化字段） ==========
CREATE TABLE t_mall_category (
  id CHAR(32) PRIMARY KEY, cat_code VARCHAR(30) NOT NULL UNIQUE, cat_name VARCHAR(100) NOT NULL,
  parent_id CHAR(32), level INT, sort_order INT, status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_product (
  id CHAR(32) PRIMARY KEY, spu_code VARCHAR(50) NOT NULL UNIQUE, product_name VARCHAR(300) NOT NULL,
  material_code VARCHAR(30), category_id CHAR(32), brand VARCHAR(100), model VARCHAR(100),
  description LONGTEXT, spec_template MEDIUMTEXT, main_image VARCHAR(500), image_list TEXT,
  video_url VARCHAR(500), status VARCHAR(20) NOT NULL, onshelf_time DATETIME, offshelf_time DATETIME,
  audit_status VARCHAR(20) DEFAULT 'PENDING', audit_by CHAR(32), shop_id CHAR(32),
  tax_rate DECIMAL(5,2) DEFAULT 13.00, unit VARCHAR(10), moq INT DEFAULT 1,
  lead_time INT, approval_required_flag TINYINT(1) DEFAULT 1,
  price_effective_from DATE, price_effective_to DATE,
  created_at DATETIME, updated_at DATETIME,
  KEY idx_cat (category_id), KEY idx_status (status), KEY idx_shop (shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_sku (
  id CHAR(32) PRIMARY KEY, sku_code VARCHAR(50) NOT NULL UNIQUE, spu_id CHAR(32),
  spec_values VARCHAR(200), spec_json MEDIUMTEXT, price DECIMAL(18,2) NOT NULL,
  market_price DECIMAL(18,2), cost_price DECIMAL(18,2), stock_qty INT DEFAULT 0,
  stock_warn_line INT DEFAULT 0, weight DECIMAL(8,2), barcode VARCHAR(50),
  status VARCHAR(20) NOT NULL,
  tax_rate DECIMAL(5,2) DEFAULT 13.00, moq INT DEFAULT 1, lead_time INT, price_effective_date DATE,
  created_at DATETIME, updated_at DATETIME,
  KEY idx_sku (sku_code), KEY idx_spu (spu_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_product_tag (
  id CHAR(32) PRIMARY KEY, product_id CHAR(32), tag_name VARCHAR(50), tag_type VARCHAR(20),
  created_at DATETIME, KEY idx_prod (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_shop (
  id CHAR(32) PRIMARY KEY, shop_code VARCHAR(50) NOT NULL UNIQUE, shop_name VARCHAR(200) NOT NULL,
  supplier_id CHAR(32), shop_type VARCHAR(20), logo_url VARCHAR(500), description TEXT,
  contact_name VARCHAR(50), contact_phone VARCHAR(20), service_score DECIMAL(3,2) DEFAULT 5.00,
  logistics_score DECIMAL(3,2) DEFAULT 5.00, status VARCHAR(20) NOT NULL, open_time DATETIME,
  created_at DATETIME, updated_at DATETIME,
  KEY idx_sup (supplier_id), KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_shop_cat (
  id CHAR(32) PRIMARY KEY, shop_id CHAR(32), category_id CHAR(32), status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME, KEY idx_shop (shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_cart (
  id CHAR(32) PRIMARY KEY, user_id CHAR(32), sku_id CHAR(32), quantity INT NOT NULL,
  selected TINYINT(1) DEFAULT 1, shop_id CHAR(32), created_at DATETIME, updated_at DATETIME,
  UNIQUE KEY uk_user_sku (user_id, sku_id), KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_order (
  id CHAR(32) PRIMARY KEY, order_no VARCHAR(50) NOT NULL UNIQUE, user_id CHAR(32),
  org_id CHAR(32), shop_id CHAR(32), total_amount DECIMAL(18,2) NOT NULL,
  discount_amount DECIMAL(18,2) DEFAULT 0, freight_amount DECIMAL(18,2) DEFAULT 0,
  pay_amount DECIMAL(18,2), currency VARCHAR(3) DEFAULT 'CNY',
  receiver_name VARCHAR(50), receiver_phone VARCHAR(20), receiver_addr VARCHAR(300),
  order_status VARCHAR(20) NOT NULL, pay_status VARCHAR(20) DEFAULT 'UNPAID',
  pay_type VARCHAR(20), pay_time DATETIME, remark VARCHAR(500), source VARCHAR(20),
  invoice_title_id CHAR(32), erp_po_no VARCHAR(50), approval_flow_id CHAR(32),
  budget_code VARCHAR(50), delivery_type VARCHAR(20), expect_date DATE,
  cancel_reason VARCHAR(500), currency_rate DECIMAL(10,4) DEFAULT 1,
  created_at DATETIME, updated_at DATETIME,
  KEY idx_order (order_no), KEY idx_user (user_id), KEY idx_status (order_status), KEY idx_shop (shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_order_item (
  id CHAR(32) PRIMARY KEY, order_id CHAR(32), sku_id CHAR(32), spu_id CHAR(32),
  product_name VARCHAR(300), spec_json MEDIUMTEXT, unit_price DECIMAL(18,2),
  quantity INT, item_amount DECIMAL(18,2), created_at DATETIME, updated_at DATETIME,
  tax_rate DECIMAL(5,2), tax_amount DECIMAL(18,2), cost_center VARCHAR(50),
  erp_po_item_id CHAR(32), delivery_date DATE,
  KEY idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_payment (
  id CHAR(32) PRIMARY KEY, pay_no VARCHAR(50) NOT NULL UNIQUE, order_id CHAR(32),
  pay_amount DECIMAL(18,2), pay_channel VARCHAR(20), pay_status VARCHAR(20),
  trans_no VARCHAR(100), pay_time DATETIME, created_at DATETIME, updated_at DATETIME,
  KEY idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_shipment (
  id CHAR(32) PRIMARY KEY, shipment_no VARCHAR(50) NOT NULL UNIQUE, order_id CHAR(32),
  shop_id CHAR(32), logistics_company VARCHAR(50), tracking_no VARCHAR(50),
  ship_status VARCHAR(20), ship_time DATETIME, sign_time DATETIME, receiver_sign VARCHAR(100),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_ship (shipment_no), KEY idx_order (order_id), KEY idx_track (tracking_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_shipment_track (
  id CHAR(32) PRIMARY KEY, shipment_id CHAR(32), track_time DATETIME,
  track_desc VARCHAR(300), location VARCHAR(200), source VARCHAR(20),
  created_at DATETIME, KEY idx_ship (shipment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_aftersale (
  id CHAR(32) PRIMARY KEY, as_no VARCHAR(50) NOT NULL UNIQUE, order_id CHAR(32),
  order_item_id CHAR(32), user_id CHAR(32), as_type VARCHAR(20), as_reason VARCHAR(200),
  as_desc TEXT, as_status VARCHAR(20), refund_amount DECIMAL(18,2), handle_by CHAR(32),
  created_at DATETIME, updated_at DATETIME,
  KEY idx_as (as_no), KEY idx_order (order_id), KEY idx_status (as_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_review (
  id CHAR(32) PRIMARY KEY, order_item_id CHAR(32), user_id CHAR(32),
  product_id CHAR(32), sku_id CHAR(32), star_level INT, content TEXT,
  image_list TEXT, reply_content TEXT, created_at DATETIME, updated_at DATETIME,
  KEY idx_prod (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_coupon (
  id CHAR(32) PRIMARY KEY, coupon_name VARCHAR(100), coupon_type VARCHAR(20),
  threshold_amount DECIMAL(18,2), discount_amount DECIMAL(18,2), discount_rate DECIMAL(5,2),
  valid_from DATETIME, valid_to DATETIME, total_count INT, received_count INT DEFAULT 0,
  used_count INT DEFAULT 0, status VARCHAR(20), created_at DATETIME, updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_user_coupon (
  id CHAR(32) PRIMARY KEY, user_id CHAR(32), coupon_id CHAR(32), status VARCHAR(20) DEFAULT 'UNUSED',
  used_order_id CHAR(32), received_at DATETIME, used_at DATETIME,
  created_at DATETIME, updated_at DATETIME, KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_search_log (
  id CHAR(32) PRIMARY KEY, user_id CHAR(32), keyword VARCHAR(200) NOT NULL,
  result_count INT, search_time DATETIME, created_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_favorite (
  id CHAR(32) PRIMARY KEY, user_id CHAR(32), product_id CHAR(32),
  created_at DATETIME, updated_at DATETIME,
  UNIQUE KEY uk_user_prod (user_id, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ========== 国网商城 电商域 新增10表 (M1~M10) ==========
CREATE TABLE t_mall_brand (
  id CHAR(32) PRIMARY KEY, brand_code VARCHAR(30) NOT NULL UNIQUE, brand_name VARCHAR(100) NOT NULL,
  brand_logo VARCHAR(500), status VARCHAR(20), created_at DATETIME, updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_address (
  id CHAR(32) PRIMARY KEY, user_id CHAR(32), receiver_name VARCHAR(50) NOT NULL,
  phone VARCHAR(20), province VARCHAR(50), city VARCHAR(50), district VARCHAR(50),
  detail_addr VARCHAR(300), is_default TINYINT(1) DEFAULT 0, tag VARCHAR(20),
  created_at DATETIME, updated_at DATETIME, KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_invoice_title (
  id CHAR(32) PRIMARY KEY, owner_id CHAR(32), title_type VARCHAR(20), title VARCHAR(200) NOT NULL,
  tax_no VARCHAR(30), bank_name VARCHAR(100), bank_account VARCHAR(50), address VARCHAR(300),
  phone VARCHAR(20), email VARCHAR(100), created_at DATETIME, updated_at DATETIME,
  KEY idx_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_invoice (
  id CHAR(32) PRIMARY KEY, order_id CHAR(32), invoice_title_id CHAR(32), invoice_type VARCHAR(20),
  amount DECIMAL(18,2), tax_amount DECIMAL(18,2), total_amount DECIMAL(18,2), invoice_no VARCHAR(50),
  drawer VARCHAR(50), issue_status VARCHAR(20) DEFAULT 'PENDING', issue_time DATETIME,
  pdf_url VARCHAR(500), erp_invoice_no VARCHAR(50), created_at DATETIME, updated_at DATETIME,
  KEY idx_order (order_id), KEY idx_invoice_no (invoice_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_receipt (
  id CHAR(32) PRIMARY KEY, order_id CHAR(32), order_item_id CHAR(32), sku_id CHAR(32),
  plan_qty DECIMAL(10,3), actual_qty DECIMAL(10,3), qualified_qty DECIMAL(10,3),
  unqualified_qty DECIMAL(10,3), qc_result VARCHAR(20), receipt_by CHAR(32),
  receipt_time DATETIME, erp_gr_no VARCHAR(50), created_at DATETIME, updated_at DATETIME,
  KEY idx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_refund (
  id CHAR(32) PRIMARY KEY, aftersale_id CHAR(32), refund_no VARCHAR(50) NOT NULL UNIQUE,
  refund_amount DECIMAL(18,2), refund_channel VARCHAR(20), refund_status VARCHAR(20) DEFAULT 'PROCESSING',
  trans_no VARCHAR(100), refund_time DATETIME, created_at DATETIME, updated_at DATETIME,
  KEY idx_refund (refund_no), KEY idx_as (aftersale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_shop_qualification (
  id CHAR(32) PRIMARY KEY, shop_id CHAR(32), qual_type VARCHAR(30), file_url VARCHAR(500),
  file_hash VARCHAR(100), valid_from DATE, valid_to DATE, status VARCHAR(20),
  created_at DATETIME, updated_at DATETIME, KEY idx_shop (shop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_promotion (
  id CHAR(32) PRIMARY KEY, promo_name VARCHAR(100), promo_type VARCHAR(20), rule_json MEDIUMTEXT,
  scope_type VARCHAR(20), scope_id CHAR(32), begin_time DATETIME, end_time DATETIME,
  status VARCHAR(20), created_at DATETIME, updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_file (
  id CHAR(32) PRIMARY KEY, biz_module VARCHAR(30), biz_id CHAR(32), file_name VARCHAR(200),
  file_url VARCHAR(500), file_hash VARCHAR(100), file_size INT, file_type VARCHAR(20),
  uploader_id CHAR(32), upload_time DATETIME, created_at DATETIME, updated_at DATETIME,
  KEY idx_biz (biz_module, biz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE t_mall_message (
  id CHAR(32) PRIMARY KEY, receiver_id CHAR(32), msg_type VARCHAR(30), title VARCHAR(200),
  content TEXT, channel VARCHAR(20), read_flag TINYINT(1) DEFAULT 0, biz_link VARCHAR(500),
  send_time DATETIME, created_at DATETIME, updated_at DATETIME,
  KEY idx_receiver (receiver_id), KEY idx_read (read_flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 细化版 v2 完成：MDM(5) + ECP交易域(25) + 国网商城电商域(28) = 63张表
-- 括号平衡校验 + 引擎校验需通过
-- ============================================================
