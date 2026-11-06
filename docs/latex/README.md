# PryingEyes documentation (LaTeX source)

Build the PDF:

    latexmk -pdf main.tex          # or: pdflatex main.tex  (run twice for the contents and references)

Needs a TeX Live installation with TikZ, tcolorbox, listings, adjustbox, needspace and pifont.
On Ubuntu: `sudo apt-get install texlive-latex-extra texlive-pictures latexmk`.
Also compiles as-is on Overleaf (upload this folder; main document: main.tex).

| File | Contents |
|---|---|
| main.tex | Document skeleton |
| preamble.tex | Styles, colours, and the TikZ macros for UML diagrams (`\actor`, `uc`, `incl`, `gen`, ...) |
| titlepage.tex | Cover |
| ch-introduction.tex | What the system does, tiers, token classes, scope |
| ch-architecture.tex | Components, stack, layout, data model, keys, audit chain |
| ch-setup.tex | Ubuntu installation, development tools, walkthrough |
| ch-configuration.tex | Every environment variable, policy defaults and fixed limits |
| ch-usecase-diagrams.tex | Actors, context diagram and six use-case diagrams |
| ch-usecase-specs.tex | Actor/use-case matrix and 47 use-case specifications |
| ch-flows.tex | Gate decision flow, Tier 3 sequence, token and request lifecycles |
| ch-operations.tex | Tests, production, retention, backups, monitoring, troubleshooting |
| ch-reference.tex | API endpoints, error codes, pages, scripts, notifications, glossary |
| app-decisions.tex | Design decisions and document history |
