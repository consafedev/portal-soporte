INSERT INTO sap_sociedad (sociedad, rfc, ambienteSap) VALUES
  ('1000', 'XAXX010101000', 'E1P'),
  ('2000', 'XAXX010101000', 'OPE');

INSERT INTO sap_proveedor
  (ambienteSap, idProveedor, sociedad, rfc, marcado_borrado, contabilizar)
VALUES
  ('E1P', 'PROV000001', '1000', 'XAXX010101000', 'X', 'N'),
  ('OPE', 'PROV000002', '2000', 'XAXX010101000', '', 'S'),
  ('E1P', 'PROV000003', '1000', 'COSC8001137NA', '', 'S'),
  ('E1P', 'PROV000004', '1000', 'COSC8001137NA', '', 'S');

INSERT INTO factura (uuid) VALUES
  ('550E8400-E29B-41D4-A716-446655440001');
