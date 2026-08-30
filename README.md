# Claude Code Handoff Package

Start with:
1. `FIRST_PROMPT_FOR_CLAUDE_CODE.md`
2. `MASTER_BUILD_SPEC.md`

Place the CSV files under `/data` in the repository.

The package contains:
- questionnaire.csv
- rule_catalog.csv
- freelancer_screening_model.csv
- exposure_factors.csv
- document_analysis_matrix.csv
- report_structure.csv
- legal_sources.csv
- the source Excel workbook for human reference

Important:
- Use synthetic data only during development.
- Lawyer review is mandatory.
- AI extracts facts; deterministic rules determine findings.
- The risk score prioritizes issues; it is not a probability of liability.
