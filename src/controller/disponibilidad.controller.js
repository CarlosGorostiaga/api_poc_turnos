const db = require("../database");

// Obtener disponibilidad de un publicador
const getByPublicador = async (req, res) => {
  try {
    const { publicador_id } = req.params;
    const { fecha_desde, fecha_hasta } = req.query;

    let query = `
      SELECT d.*, 
             pd.ubicacion,
             pt.capacidad
      FROM disponibilidad d
      LEFT JOIN poc_dia pd ON d.fecha = pd.fecha
      LEFT JOIN poc_turnos pt ON pt.poc_dia_id = pd.id AND pt.turno = d.turno
      WHERE d.publicador_id = $1
    `;

    const params = [publicador_id];

    if (fecha_desde) {
      query += ` AND d.fecha >= $${params.length + 1}`;
      params.push(fecha_desde);
    }

    if (fecha_hasta) {
      query += ` AND d.fecha <= $${params.length + 1}`;
      params.push(fecha_hasta);
    }

    query += " ORDER BY d.fecha, d.turno";

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Obtener disponibilidad para una fecha y turno específicos
const getByFechaTurno = async (req, res) => {
  try {
    const { fecha, turno } = req.query;

    if (!fecha || !turno) {
      return res.status(400).json({
        error: "Se requieren fecha y turno",
      });
    }

    const result = await db.query(
      `
      SELECT d.*,
             p.nombre,
             p.tipo,
             p.pareja_id,
             pareja.nombre as pareja_nombre
      FROM disponibilidad d
      JOIN publicadores p ON d.publicador_id = p.id
      LEFT JOIN publicadores pareja ON p.pareja_id = pareja.id
      WHERE d.fecha = $1 AND d.turno = $2
      ORDER BY p.nombre
    `,
      [fecha, turno],
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Marcar disponibilidad de un publicador
const marcarDisponibilidad = async (req, res) => {
  try {
    const { publicador_id, fecha, turno, disponible } = req.body;

    if (!publicador_id || !fecha || !turno) {
      return res.status(400).json({
        error: "Se requieren publicador_id, fecha y turno",
      });
    }

    // Verificar que el publicador existe
    const pubCheck = await db.query(
      "SELECT id FROM publicadores WHERE id = $1 AND activo = true",
      [publicador_id],
    );

    if (pubCheck.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Publicador no encontrado o inactivo" });
    }

    // Insertar o actualizar disponibilidad
    const result = await db.query(
      `
      INSERT INTO disponibilidad (publicador_id, fecha, turno, disponible)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (publicador_id, fecha, turno)
      DO UPDATE SET 
        disponible = $4,
        created_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
      [publicador_id, fecha, turno, disponible !== false],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Marcar disponibilidad múltiple (varios turnos a la vez)
const marcarDisponibilidadMultiple = async (req, res) => {
  const client = await db.connect();

  try {
    const { publicador_id, disponibilidades } = req.body;

    // disponibilidades: [
    //   { fecha: "2025-02-10", turno: "manana", disponible: true },
    //   { fecha: "2025-02-10", turno: "tarde", disponible: false },
    //   ...
    // ]

    if (!publicador_id || !disponibilidades || disponibilidades.length === 0) {
      return res.status(400).json({
        error: "Se requieren publicador_id y al menos una disponibilidad",
      });
    }

    // Verificar que el publicador existe
    const pubCheck = await client.query(
      "SELECT id FROM publicadores WHERE id = $1 AND activo = true",
      [publicador_id],
    );

    if (pubCheck.rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Publicador no encontrado o inactivo" });
    }

    await client.query("BEGIN");

    const resultados = [];
    for (const disp of disponibilidades) {
      const result = await client.query(
        `
        INSERT INTO disponibilidad (publicador_id, fecha, turno, disponible)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (publicador_id, fecha, turno)
        DO UPDATE SET 
          disponible = $4,
          created_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
        [publicador_id, disp.fecha, disp.turno, disp.disponible !== false],
      );

      resultados.push(result.rows[0]);
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "Disponibilidades actualizadas",
      disponibilidades: resultados,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// Eliminar disponibilidad
const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "DELETE FROM disponibilidad WHERE id = $1 RETURNING *",
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Disponibilidad no encontrada" });
    }
    res.json({ message: "Disponibilidad eliminada" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getByPublicador,
  getByFechaTurno,
  marcarDisponibilidad,
  marcarDisponibilidadMultiple,
  remove,
};
