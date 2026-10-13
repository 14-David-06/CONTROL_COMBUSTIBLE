// ============================================================================
// tanque-movil.routes.js (INFRAESTRUCTURA) — ENDPOINTS DEL TANQUE MÓVIL
// ----------------------------------------------------------------------------
//   GET    /api/tanque-movil?fecha=YYYY-MM-DD -> entregas del día y su total
//   POST   /api/tanque-movil                  -> registrar una entrega
//   PUT    /api/tanque-movil/:id              -> corregir una entrega
//   DELETE /api/tanque-movil/:id              -> anular (requiere motivo)
// Todo exige el permiso 'tanque_movil' (se asigna en Usuarios al supervisor).
// ============================================================================

const express = require('express');
const { requirePermission } = require('../../shared/infrastructure/security');
const { registrarAuditoria } = require('../../shared/infrastructure/audit');
const { hoyLocal } = require('../../shared/application/fechas');

function crearRutasTanqueMovil(service, auditRepository) {
  const router = express.Router();
  const permiso = requirePermission('tanque_movil');
  const auditar = (req, accion, registroId, detalle) =>
    registrarAuditoria(auditRepository, {
      usuarioId: req.user.id,
      usuario: req.user.usuario,
      rol: req.user.rol,
      accion,
      modulo: 'tanque_movil',
      registroId,
      detalle
    });

  router.get('/tanque-movil', permiso, async (req, res, next) => {
    try {
      res.json(await service.resumenDia(String(req.query.fecha || hoyLocal())));
    } catch (error) {
      next(error);
    }
  });

  router.post('/tanque-movil', permiso, async (req, res, next) => {
    try {
      const creada = await service.crear(req.body || {}, req.user.usuario);
      await auditar(req, 'CREAR', creada.id, creada);
      res.status(201).json(creada);
    } catch (error) {
      next(error);
    }
  });

  router.put('/tanque-movil/:id', permiso, async (req, res, next) => {
    try {
      const { antes, despues } = await service.actualizar(req.params.id, req.body || {});
      await auditar(req, 'EDITAR', req.params.id, { antes, despues });
      res.json(despues);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/tanque-movil/:id', permiso, async (req, res, next) => {
    try {
      const motivo = req.body?.motivo;
      const antes = await service.anular(req.params.id, motivo, req.user.usuario);
      await auditar(req, 'ELIMINAR', req.params.id, { antes, motivo });
      res.json({ mensaje: 'Entrega anulada.' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { crearRutasTanqueMovil };
