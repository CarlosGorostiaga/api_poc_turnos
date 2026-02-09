const express = require("express");
const router = express.Router();
const controller = require("../controller/turnos.controller");

// Obtener publicadores disponibles para un turno
router.get("/disponibles", controller.getPublicadoresDisponibles);

// Asignar publicadores a un turno
router.post("/asignar", controller.asignarTurno);

// Sugerir asignación automática con rotación
router.get("/:poc_turno_id/sugerir", controller.sugerirAsignacion);

module.exports = router;
