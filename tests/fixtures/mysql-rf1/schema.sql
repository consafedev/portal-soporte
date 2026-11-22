CREATE TABLE sap_sociedad (
  sociedad VARCHAR(4) NOT NULL,
  rfc VARCHAR(48) NOT NULL,
  ambienteSap VARCHAR(3) NOT NULL,
  PRIMARY KEY (sociedad),
  KEY idx_sap_sociedad_rfc (rfc)
) ENGINE=InnoDB;

CREATE TABLE sap_proveedor (
  ambienteSap VARCHAR(3) NOT NULL,
  idProveedor VARCHAR(10) NOT NULL,
  sociedad VARCHAR(4) NOT NULL,
  rfc VARCHAR(15) NOT NULL,
  marcado_borrado VARCHAR(1) NOT NULL DEFAULT '',
  contabilizar VARCHAR(1) NOT NULL DEFAULT 'S',
  PRIMARY KEY (ambienteSap, idProveedor, sociedad),
  KEY idx_sap_proveedor_lookup (rfc, sociedad, ambienteSap)
) ENGINE=InnoDB;

CREATE TABLE factura (
  uuid VARCHAR(40) NOT NULL,
  nodocumentocontable VARCHAR(10) NULL,
  ejercicio VARCHAR(4) NOT NULL,
  rfcReceptor VARCHAR(15) NOT NULL,
  rfcEmisor VARCHAR(15) NOT NULL,
  folio VARCHAR(100) NULL,
  serie VARCHAR(25) NULL,
  fecha VARCHAR(10) NOT NULL,
  monedaFAC VARCHAR(5) NOT NULL,
  totalFAC DECIMAL(12, 2) NOT NULL,
  subtotalFAC DECIMAL(12, 2) NOT NULL,
  importeIvaFAC DECIMAL(12, 2) NOT NULL,
  rutaXml VARCHAR(196) NOT NULL,
  rutaPdf VARCHAR(196) NULL,
  estatus VARCHAR(25) NOT NULL,
  version VARCHAR(5) NOT NULL,
  fechaCarga DATETIME NOT NULL,
  nea VARCHAR(2000) NULL,
  tipoComprobante VARCHAR(20) NOT NULL,
  metododepago VARCHAR(100) NULL,
  formadepago VARCHAR(100) NULL,
  numctapago VARCHAR(50) NULL,
  referencia VARCHAR(100) NOT NULL,
  nodocumentopago VARCHAR(10) NULL,
  noa VARCHAR(2000) NULL,
  creadoPor VARCHAR(10) NOT NULL,
  nodocumentologistico VARCHAR(10) NULL,
  sociedad VARCHAR(8) NOT NULL,
  retencionIsr DECIMAL(8, 2) NOT NULL,
  retencionIva DECIMAL(8, 2) NOT NULL,
  retencionIeps DECIMAL(8, 2) NOT NULL,
  moduloOrigen VARCHAR(4) NOT NULL,
  detraccion_pe DECIMAL(7, 2) NULL,
  PRIMARY KEY (uuid),
  CONSTRAINT chk_fixture_reject_uuid CHECK (uuid <> '550E8400-E29B-41D4-A716-446655440004')
) ENGINE=InnoDB;
