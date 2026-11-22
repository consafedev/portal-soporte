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

INSERT INTO factura (
  uuid, nodocumentocontable, ejercicio, rfcReceptor, rfcEmisor, folio, serie, fecha,
  monedaFAC, totalFAC, subtotalFAC, importeIvaFAC, rutaXml, rutaPdf, estatus, version,
  fechaCarga, nea, tipoComprobante, metododepago, formadepago, numctapago, referencia,
  nodocumentopago, noa, creadoPor, nodocumentologistico, sociedad, retencionIsr,
  retencionIva, retencionIeps, moduloOrigen, detraccion_pe
) VALUES (
  '550E8400-E29B-41D4-A716-446655440001', NULL, '2025', 'XAXX010101000', 'COSC8001137NA',
  NULL, NULL, '2025-06-07', 'MXN', 1450.58, 1250.50, 200.08, 'AgregadoAutomatizado',
  NULL, 'CONTABILIZADO', '4.0', '2026-11-22 07:00:00', NULL, 'I', 'PUE', '03', NULL,
  '', NULL, NULL, 'PROV000001', NULL, '1000', 0, 0, 0, 'REF', NULL
);
