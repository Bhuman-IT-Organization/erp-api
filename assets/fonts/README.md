# Fonts

The font every server-side PDF that prints names embeds (first: the item barcode labels of plan
04.2-17). One file covers Arabic and Latin, so a mixed name needs no font switching.

| Field           | Value                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| File            | `label-font.ttf`                                                                                                                                                                                                         |
| Family          | IBM Plex Sans Arabic, Regular (PostScript name `IBMPlexSansArabic`)                                                                                                                                                      |
| Version         | release `@ibm/plex-sans-arabic@1.1.0` (published 2024-11-13)                                                                                                                                                             |
| Source          | IBM's official release on GitHub: <https://github.com/IBM/plex/releases/download/%40ibm/plex-sans-arabic%401.1.0/ibm-plex-sans-arabic.zip>, file `ibm-plex-sans-arabic/fonts/complete/ttf/IBMPlexSansArabic-Regular.ttf` |
| Archive sha-256 | `f03915581aea37d82792c188b08064023a73494d679b8e19f85f5971db714013`                                                                                                                                                       |
| File sha-256    | `8e0f1046c736bf939d4939ee3ae0116acf61cbcd6592deae7656761627080981`                                                                                                                                                       |
| Size            | 236,708 bytes                                                                                                                                                                                                            |
| Licence         | SIL Open Font License 1.1, `OFL.txt` beside it (the release's `fonts/complete/ttf/license.txt`), Copyright 2017 IBM Corp. with Reserved Font Name "Plex"                                                                 |

Chosen by the migration lead in plan 04.2-17 (ADR-0041 § Approved dependencies; under ADR-0017's
licence policy fonts are assets, as Inter is), option a of the plan's Task 1, 2026-10-03.

The file is used unmodified. The OFL lets it be bundled with this software and embedded in the
documents it produces; it may not be sold by itself, and a modified version may not use the name
"Plex". The Dockerfile copies `assets/` into the api image, and `labels.ts` reads it from
`assets/fonts/label-font.ttf` under the working directory.

To check the file: `sha256sum assets/fonts/label-font.ttf` prints the file sha-256 above.
