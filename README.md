# Apuração Cariri Ocidental

Aplicativo desktop em Electron para registrar e acompanhar a apuração eleitoral dos municípios presentes na planilha `apuracaocaririocidental.xlsx`.

## Abrir o aplicativo

O executável portátil fica em:

`dist/Apuração Cariri Ocidental 1.1.0.exe`

Ele não precisa ser instalado. O aplicativo funciona localmente e não envia dados para a internet.

## Fluxo de uso

1. Consulte o progresso e os resultados em **Visão geral**.
2. Abra **Votos por município** para comparar cada candidato nos nove municípios.
3. Use **Lançamento** para escolher município, local e seção.
4. Informe os votos dos candidatos e altere a situação para **Apurada**.
5. Confira pendências na tela **Seções**.
6. Use **Exportar cópia Excel** para gerar uma planilha atualizada sem substituir a origem.

Os lançamentos ficam salvos localmente no aplicativo. A exportação cria um arquivo `.xlsx` independente.

## Executar pelo código-fonte

Requer Node.js.

```powershell
npm install
npm start
```

Testes:

```powershell
npm test
```

Gerar novamente o executável portátil:

```powershell
npm run build
```

## Estrutura da planilha

O importador identifica automaticamente a linha de cabeçalho de cada aba municipal. A estrutura esperada é a mesma da planilha fornecida: zona, local, seção, eleitores do local, status e colunas de candidatos.
