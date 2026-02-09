const express = require("express");
const cors = require("cors");

const publicadoresRouter = require("./routers/publicadores.routers");
const pocDiasRouter = require("./routers/poc_dias.routers");
const disponibilidadRouter = require("./routers/disponibilidad.routers");
const turnosRouter = require("./routers/turnos.routers");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", async (req, res) => {
  const db = require("./database");
  try {
    const result = await db.query("SELECT NOW()");
    res.json({ status: "ok", db_time: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// Rutas
app.use("/api/publicadores", publicadoresRouter);
app.use("/api/poc-dias", pocDiasRouter);
app.use("/api/disponibilidad", disponibilidadRouter);
app.use("/api/turnos", turnosRouter);

app.listen(PORT, () => {
  console.log(`🚀 Backend POC Turnos en http://localhost:${PORT}`);
});
