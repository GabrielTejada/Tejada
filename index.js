const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// Configuração do Express
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Conexão com o banco SQLite e criação das tabelas
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados SQLite:', err.message);
    } else {
        console.log('Conectado ao banco SQLite.');
        criarTabelas();
    }
});

// Função para criar/verificar as tabelas
function criarTabelas() {
    const tabelas = [
        `CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            whatsapp TEXT,
            local TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL,
            descricao TEXT,
            preco REAL
        )`,
        `CREATE TABLE IF NOT EXISTS vendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data TEXT,
            cliente_id INTEGER,
            produto_id INTEGER,
            quantidade INTEGER,
            valor_total REAL,
            metodo_pagamento TEXT,
            status TEXT,
            FOREIGN KEY (cliente_id) REFERENCES clientes (id),
            FOREIGN KEY (produto_id) REFERENCES produtos (id)
        )`
    ];

    tabelas.forEach((query) => {
        db.run(query, (err) => {
            if (err) console.error(`Erro ao criar tabela: ${err.message}`);
        });
    });
}

// Rota para servir extrato-cliente.html
app.get('/extrato-cliente.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'extrato-cliente.html'));
});

// Rota para listar clientes
app.get('/clientes', (req, res) => {
    db.all(`SELECT * FROM clientes ORDER BY nome ASC`, [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar clientes:', err.message);
            res.status(400).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Rota para adicionar cliente
app.post('/clientes', (req, res) => {
    const { nome, whatsapp, local } = req.body;

    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    const query = `INSERT INTO clientes (nome, whatsapp, local) VALUES (?, ?, ?)`;
    db.run(query, [nome, whatsapp, local], function (err) {
        if (err) {
            console.error('Erro ao inserir cliente:', err.message);
            res.status(400).json({ error: err.message });
        } else {
            res.json({ message: 'Cliente adicionado com sucesso!', clienteId: this.lastID });
        }
    });
});

// Rota para listar produtos
app.get('/produtos', (req, res) => {
    db.all(`SELECT * FROM produtos ORDER BY CAST(codigo AS INTEGER) ASC`, [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar produtos:', err.message);
            res.status(400).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Rota para adicionar produto
app.post('/produtos', (req, res) => {
    const { codigo, descricao, preco } = req.body;

    const query = `INSERT INTO produtos (codigo, descricao, preco) VALUES (?, ?, ?)`;
    db.run(query, [codigo, descricao, preco], function (err) {
        if (err) {
            console.error('Erro ao inserir produto:', err.message);
            res.status(400).json({ error: err.message });
        } else {
            res.json({ message: 'Produto adicionado com sucesso!', produtoId: this.lastID });
        }
    });
});

// Rota para registrar venda
app.post('/vendas', (req, res) => {
    const { data, cliente_id, produto_id, quantidade, valor_total, metodo_pagamento, status } = req.body;

    if (!cliente_id || !produto_id || !quantidade || !valor_total) {
        return res.status(400).json({ error: 'Dados incompletos para registrar venda' });
    }

    const query = `
      INSERT INTO vendas (data, cliente_id, produto_id, quantidade, valor_total, metodo_pagamento, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(query, [data, cliente_id, produto_id, quantidade, valor_total, metodo_pagamento, status], function (err) {
        if (err) {
            console.error('Erro ao registrar venda:', err.message);
            res.status(400).json({ error: err.message });
        } else {
            res.json({ message: 'Venda registrada com sucesso!', vendaId: this.lastID });
        }
    });
});

// Rota para listar fiados
app.get('/fiados', (req, res) => {
    const query = `
      SELECT clientes.id, clientes.nome, SUM(vendas.valor_total) AS valor
      FROM vendas
      JOIN clientes ON vendas.cliente_id = clientes.id
      WHERE vendas.status = 'PENDENTE'
      GROUP BY clientes.id, clientes.nome
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar fiados:', err.message);
            res.status(400).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Rota para buscar extrato de cliente
app.get('/clientes/:id/extrato', (req, res) => {
    const clienteId = req.params.id;
    const query = `
      SELECT data, valor_total AS valor, status
      FROM vendas
      WHERE cliente_id = ?
      ORDER BY data DESC
    `;

    db.all(query, [clienteId], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar extrato:', err.message);
            res.status(400).json({ error: err.message });
        } else {
            res.json(rows);
        }
    });
});

// Rota para aba financeiro
app.get('/financeiro', (req, res) => {
    const queryResumo = `
      SELECT 
        SUM(valor_total) AS totalMes,
        SUM(CASE WHEN status = 'CONCLUÍDO' THEN valor_total ELSE 0 END) AS totalPago,
        SUM(CASE WHEN status = 'PENDENTE' THEN valor_total ELSE 0 END) AS totalPendente
      FROM vendas
      WHERE strftime('%Y-%m', data) = strftime('%Y-%m', 'now')
    `;

    const queryExtrato = `
      SELECT 
        vendas.data, 
        clientes.nome AS cliente, 
        produtos.descricao AS descricao, 
        vendas.valor_total AS valor, 
        vendas.status 
      FROM vendas
      JOIN clientes ON vendas.cliente_id = clientes.id
      JOIN produtos ON vendas.produto_id = produtos.id
      ORDER BY vendas.data DESC
    `;

    db.get(queryResumo, (err, resumo) => {
        if (err) {
            console.error('Erro ao carregar resumo financeiro:', err);
            return res.status(500).json({ error: 'Erro ao carregar resumo financeiro' });
        }

        db.all(queryExtrato, (err, extrato) => {
            if (err) {
                console.error('Erro ao carregar extrato financeiro:', err);
                return res.status(500).json({ error: 'Erro ao carregar extrato financeiro' });
            }

            res.json({ ...resumo, extrato });
        });
    });
});

// Rota para buscar extrato de cliente com resumo mensal
app.get('/clientes/:id/extrato', (req, res) => {
    const clienteId = req.params.id;

    const queryMovimentacoes = `
      SELECT data, valor_total AS valor, status
      FROM vendas
      WHERE cliente_id = ?
      ORDER BY data DESC
    `;

    const queryResumo = `
      SELECT 
        SUM(CASE WHEN strftime('%Y-%m', data) = strftime('%Y-%m', 'now', '-1 month') THEN valor_total ELSE 0 END) AS mesAnterior,
        SUM(CASE WHEN strftime('%Y-%m', data) = strftime('%Y-%m', 'now') THEN valor_total ELSE 0 END) AS mesAtual
      FROM vendas
      WHERE cliente_id = ?
    `;

    const queryNome = `SELECT nome FROM clientes WHERE id = ?`;

    db.get(queryNome, [clienteId], (err, cliente) => {
        if (err) {
            console.error('Erro ao buscar nome do cliente:', err);
            return res.status(400).json({ error: err.message });
        }

        if (!cliente) {
            return res.status(404).json({ error: 'Cliente não encontrado' });
        }

        db.get(queryResumo, [clienteId], (err, resumo) => {
            if (err) {
                console.error('Erro ao buscar resumo:', err);
                return res.status(400).json({ error: err.message });
            }

            db.all(queryMovimentacoes, [clienteId], (err, movimentacoes) => {
                if (err) {
                    console.error('Erro ao buscar movimentações:', err);
                    return res.status(400).json({ error: err.message });
                }

                res.json({
                    nome: cliente.nome,
                    movimentacoes,
                    mesAnterior: resumo.mesAnterior || 0,
                    mesAtual: resumo.mesAtual || 0,
                });
            });
        });
    });
});
// Inicia o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});