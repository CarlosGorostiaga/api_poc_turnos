const express = require("express");
const router = express.Router();
const controller = require("../controller/disponibilidad.controller");

// Por publicador
router.get("/publicador/:publicador_id", controller.getByPublicador);

// Por fecha y turno
router.get("/fecha-turno", controller.getByFechaTurno);

// Marcar disponibilidad individual
router.post("/", controller.marcarDisponibilidad);

// Marcar disponibilidad múltiple
router.post("/multiple", controller.marcarDisponibilidadMultiple);

// Eliminar
router.delete("/:id", controller.remove);

module.exports = router;
