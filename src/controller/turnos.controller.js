const db = require("../database");

/**
 * Obtener publicadores disponibles para un turno específico
 * Considera disponibilidad, tipo de publicador y restricciones
 */
const getPublicadoresDisponibles = async (req, res) => {
  try {
    const { fecha, turno } = req.query;

    if (!fecha || !turno) {
      return res.status(400).json({
        error: "Se requieren fecha y turno",
      });
    }

    // Obtener todos los publicadores activos con su disponibilidad
    const result = await db.query(
      `
      SELECT 
        p.id,
        p.nombre,
        p.tipo,
        p.pareja_id,
        p.tutor_id,
        pareja.nombre as pareja_nombre,
        tutor.nombre as tutor_nombre,
        COALESCE(d.disponible, true) as disponible
      FROM publicadores p
      LEFT JOIN publicadores pareja ON p.pareja_id = pareja.id
      LEFT JOIN publicadores tutor ON p.tutor_id = tutor.id
      LEFT JOIN disponibilidad d ON d.publicador_id = p.id 
        AND d.fecha = $1 
        AND d.turno = $2
      WHERE p.activo = true
      ORDER BY p.nombre
    `,
      [fecha, turno],
    );

    // Clasificar publicadores
    const disponibles = {
      solos: [],
      matrimonios: [],
      menores: [],
    };

    const matrimoniosMap = new Map();

    result.rows.forEach((pub) => {
      if (!pub.disponible) return; // Saltar si no está disponible

      if (pub.tipo === "matrimonio") {
        // Agrupar matrimonios
        const parejaId = pub.pareja_id;
        if (!matrimoniosMap.has(parejaId)) {
          matrimoniosMap.set(parejaId, []);
        }
        matrimoniosMap.get(parejaId).push(pub);
      } else if (pub.tipo === "menor") {
        disponibles.menores.push(pub);
      } else if (pub.tipo === "solo") {
        disponibles.solos.push(pub);
      }
    });

    // Procesar matrimonios (ambos deben estar disponibles para ir juntos)
    matrimoniosMap.forEach((pareja) => {
      if (pareja.length === 2) {
        disponibles.matrimonios.push({
          id: `matrimonio_${pareja[0].id}_${pareja[1].id}`,
          miembro1: pareja[0],
          miembro2: pareja[1],
          ambos_disponibles: true,
          ocupa_slots: 2,
        });
      } else {
        // Solo uno del matrimonio está disponible
        const disponible = pareja[0];
        disponibles.solos.push({
          ...disponible,
          nota: "Matrimonio - solo disponible individualmente",
        });
      }
    });

    res.json(disponibles);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Asignar publicadores a un turno con validaciones
 */
const asignarTurno = async (req, res) => {
  const client = await db.connect();

  try {
    const { poc_turno_id, asignaciones } = req.body;

    // asignaciones: [
    //   { publicador_id: "uuid", tipo_asignacion: "solo" | "matrimonio" | "menor_con_tutor" },
    //   ...
    // ]

    if (!poc_turno_id || !asignaciones || asignaciones.length === 0) {
      return res.status(400).json({
        error: "Se requiere poc_turno_id y al menos una asignación",
      });
    }

    await client.query("BEGIN");

    // Obtener información del turno
    const turnoInfo = await client.query(
      `
      SELECT pt.*, pd.fecha, pd.ubicacion
      FROM poc_turnos pt
      JOIN poc_dia pd ON pt.poc_dia_id = pd.id
      WHERE pt.id = $1
    `,
      [poc_turno_id],
    );

    if (turnoInfo.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Turno no encontrado" });
    }

    const turno = turnoInfo.rows[0];

    if (turno.bloqueado) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "El turno está bloqueado" });
    }

    // Validar y procesar asignaciones
    const asignadosValidados = [];
    let slotsOcupados = 0;

    for (const asignacion of asignaciones) {
      const validacion = await validarAsignacion(
        client,
        asignacion,
        turno.fecha,
        turno.turno,
      );

      if (!validacion.valido) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: validacion.error });
      }

      slotsOcupados += validacion.slots_ocupados;
      asignadosValidados.push(validacion.datos);
    }

    // Validar capacidad
    if (slotsOcupados > turno.capacidad) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Capacidad excedida. Slots disponibles: ${turno.capacidad}, intentando ocupar: ${slotsOcupados}`,
      });
    }

    // Guardar asignaciones
    const result = await client.query(
      `
      UPDATE poc_turnos
      SET asignados = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `,
      [JSON.stringify(asignadosValidados), poc_turno_id],
    );

    await client.query("COMMIT");

    res.json({
      message: "Turno asignado exitosamente",
      turno: result.rows[0],
      slots_ocupados: slotsOcupados,
      slots_disponibles: turno.capacidad - slotsOcupados,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

/**
 * Validar una asignación individual
 */
async function validarAsignacion(client, asignacion, fecha, turno) {
  const { publicador_id, tipo_asignacion, publicador2_id, tutor_id } =
    asignacion;

  // Obtener info del publicador
  const pubResult = await client.query(
    `
    SELECT p.*, pareja.id as pareja_id_real
    FROM publicadores p
    LEFT JOIN publicadores pareja ON p.pareja_id = pareja.id
    WHERE p.id = $1 AND p.activo = true
  `,
    [publicador_id],
  );

  if (pubResult.rows.length === 0) {
    return { valido: false, error: "Publicador no encontrado o inactivo" };
  }

  const publicador = pubResult.rows[0];

  // Validar disponibilidad
  const dispResult = await client.query(
    `
    SELECT disponible FROM disponibilidad
    WHERE publicador_id = $1 AND fecha = $2 AND turno = $3
  `,
    [publicador_id, fecha, turno],
  );

  if (dispResult.rows.length > 0 && !dispResult.rows[0].disponible) {
    return {
      valido: false,
      error: `${publicador.nombre} no está disponible para este turno`,
    };
  }

  // Validaciones según tipo
  if (tipo_asignacion === "matrimonio") {
    if (publicador.tipo !== "matrimonio") {
      return {
        valido: false,
        error: `${publicador.nombre} no está registrado como matrimonio`,
      };
    }

    if (!publicador2_id) {
      return {
        valido: false,
        error: "Se requiere publicador2_id para asignación de matrimonio",
      };
    }

    // Validar que ambos sean pareja
    if (publicador.pareja_id_real !== publicador2_id) {
      return {
        valido: false,
        error: "Los publicadores no forman un matrimonio",
      };
    }

    // Validar disponibilidad del segundo
    const disp2Result = await client.query(
      `
      SELECT disponible FROM disponibilidad
      WHERE publicador_id = $1 AND fecha = $2 AND turno = $3
    `,
      [publicador2_id, fecha, turno],
    );

    if (disp2Result.rows.length > 0 && !disp2Result.rows[0].disponible) {
      const pub2 = await client.query(
        "SELECT nombre FROM publicadores WHERE id = $1",
        [publicador2_id],
      );
      return {
        valido: false,
        error: `${pub2.rows[0].nombre} no está disponible para este turno`,
      };
    }

    return {
      valido: true,
      slots_ocupados: 2,
      datos: {
        tipo: "matrimonio",
        publicador1_id: publicador_id,
        publicador2_id: publicador2_id,
        nombres: [publicador.nombre],
      },
    };
  }

  if (tipo_asignacion === "menor_con_tutor") {
    if (publicador.tipo !== "menor") {
      return {
        valido: false,
        error: `${publicador.nombre} no está registrado como menor`,
      };
    }

    if (!tutor_id) {
      return {
        valido: false,
        error: "Se requiere tutor_id para asignación de menor",
      };
    }

    // Validar que el tutor esté asignado
    const tutorValido = await client.query(
      `
      SELECT id FROM publicadores 
      WHERE id = $1 AND activo = true
    `,
      [tutor_id],
    );

    if (tutorValido.rows.length === 0) {
      return {
        valido: false,
        error: "El tutor especificado no está disponible",
      };
    }

    return {
      valido: true,
      slots_ocupados: 0, // El menor no ocupa slot adicional, va con el tutor
      datos: {
        tipo: "menor_con_tutor",
        publicador_id: publicador_id,
        tutor_id: tutor_id,
        nombre: publicador.nombre,
      },
    };
  }

  // Asignación individual (solo)
  return {
    valido: true,
    slots_ocupados: 1,
    datos: {
      tipo: "solo",
      publicador_id: publicador_id,
      nombre: publicador.nombre,
    },
  };
}

/**
 * Sugerir asignación automática con rotación
 */
const sugerirAsignacion = async (req, res) => {
  try {
    const { poc_turno_id } = req.params;

    const client = await db.connect();

    try {
      // Obtener info del turno
      const turnoInfo = await client.query(
        `
        SELECT pt.*, pd.fecha, pd.ubicacion
        FROM poc_turnos pt
        JOIN poc_dia pd ON pt.poc_dia_id = pd.id
        WHERE pt.id = $1
      `,
        [poc_turno_id],
      );

      if (turnoInfo.rows.length === 0) {
        return res.status(404).json({ error: "Turno no encontrado" });
      }

      const turno = turnoInfo.rows[0];

      // Obtener publicadores disponibles
      const disponibles = await client.query(
        `
        SELECT 
          p.id,
          p.nombre,
          p.tipo,
          p.pareja_id,
          pareja.nombre as pareja_nombre,
          COALESCE(d.disponible, true) as disponible,
          -- Contar cuántas veces ha sido asignado en los últimos 30 días
          (
            SELECT COUNT(*)
            FROM poc_turnos pt2
            JOIN poc_dia pd2 ON pt2.poc_dia_id = pd2.id
            WHERE pd2.fecha >= $2 - INTERVAL '30 days'
              AND pd2.fecha < $2
              AND pt2.asignados::text LIKE '%' || p.id::text || '%'
          ) as veces_asignado
        FROM publicadores p
        LEFT JOIN publicadores pareja ON p.pareja_id = pareja.id
        LEFT JOIN disponibilidad d ON d.publicador_id = p.id 
          AND d.fecha = $2
          AND d.turno = $3
        WHERE p.activo = true
          AND COALESCE(d.disponible, true) = true
        ORDER BY veces_asignado ASC, RANDOM()
      `,
        [poc_turno_id, turno.fecha, turno.turno],
      );

      // Algoritmo de sugerencia con prioridad a menos asignados
      const sugerencia = [];
      let slotsUsados = 0;
      const yaAsignados = new Set();

      for (const pub of disponibles.rows) {
        if (slotsUsados >= turno.capacidad) break;
        if (yaAsignados.has(pub.id)) continue;

        if (pub.tipo === "matrimonio" && pub.pareja_id) {
          // Buscar si la pareja también está disponible
          const pareja = disponibles.rows.find((p) => p.id === pub.pareja_id);

          if (
            pareja &&
            !yaAsignados.has(pareja.id) &&
            slotsUsados + 2 <= turno.capacidad
          ) {
            sugerencia.push({
              tipo: "matrimonio",
              publicador1_id: pub.id,
              publicador2_id: pareja.id,
              nombres: `${pub.nombre} y ${pareja.nombre}`,
              slots: 2,
              veces_asignado: pub.veces_asignado,
            });
            yaAsignados.add(pub.id);
            yaAsignados.add(pareja.id);
            slotsUsados += 2;
          } else if (slotsUsados + 1 <= turno.capacidad) {
            // Solo uno del matrimonio disponible
            sugerencia.push({
              tipo: "solo",
              publicador_id: pub.id,
              nombre: pub.nombre,
              nota: "Matrimonio - individual",
              slots: 1,
              veces_asignado: pub.veces_asignado,
            });
            yaAsignados.add(pub.id);
            slotsUsados += 1;
          }
        } else if (pub.tipo === "solo" && slotsUsados + 1 <= turno.capacidad) {
          sugerencia.push({
            tipo: "solo",
            publicador_id: pub.id,
            nombre: pub.nombre,
            slots: 1,
            veces_asignado: pub.veces_asignado,
          });
          yaAsignados.add(pub.id);
          slotsUsados += 1;
        }
      }

      res.json({
        turno_id: poc_turno_id,
        fecha: turno.fecha,
        turno: turno.turno,
        capacidad: turno.capacidad,
        sugerencia,
        slots_usados: slotsUsados,
        slots_disponibles: turno.capacidad - slotsUsados,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getPublicadoresDisponibles,
  asignarTurno,
  sugerirAsignacion,
};
