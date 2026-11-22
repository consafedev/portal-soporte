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
  PRIMARY KEY (uuid)
) ENGINE=InnoDB;
