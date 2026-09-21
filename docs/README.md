# MTX / FoodEx2 katalogutforsker

Åpne **`index.html` direkte i nettleseren** (dobbeltklikk). Ingen server,
nettforbindelse, installasjon eller byggetrinn er nødvendig for å bruke siden.
Behold `index.html`, `styles.css`, `app.js`, `catalogue-core.js` og
`catalogue-data.js` i samme mappe. De kan også legges på et statisk nettsted.

## Funksjoner

- Søk i alle termer: kode, navn, beskrivelse, synonymer, vitenskapelige navn,
  attributtverdier, hierarkier og navn på implisitte fasetter.
- Kombiner flere søkeord (alle må finnes), eller bruk `"en hel frase"`.
  Søket ignorerer store/små bokstaver og aksenter. `/` fokuserer søkefeltet.
- Filtrer på hierarki/fasett, termtype og utgåtte termer. Eksakte kodetreff
  prioriteres. Sorter etter relevans, navn eller kode.
- Se komplette termdetaljer, alternative navn, metadata, rapporterbarhet i
  hvert hierarki, implisitte fasetter, foreldre og barn. Søk i en hel gren.
- Tolk grunnkoder, enkeltfasetter (`F01.A04YE`) og kombinerte koder. Lim inn
  én kode per linje for batch-oppslag. Kombinerte koder i hovedsøket åpner
  kodetolkeren automatisk.
- Bygg en kode fra termdetaljene med «Bruk som grunnkode» og «Legg til F…».
  Fasetter legges til siste kodelinje i kodetolkeren.
- Fasettoversikt med definisjoner og lenker til tilhørende termer.
- «Siste søk» husker de 50 siste katalogsøkene og kodetolkningene lokalt i
  nettleseren. Åpne en oppføring for å gjenbruke søkeord, filtre, sortering og
  hierarkigren, eller hele settet med koder fra en batch-tolkning. Like søk
  flyttes øverst uten duplikater. Enkeltoppføringer og hele historikken kan slettes.
- Kopier koder, tolkninger og direkte termlenker; eksporter alle filtrerte
  treff eller tolkninger som CSV (semikolon, UTF-8 med BOM).

Grensesnittet er norsk. Katalogtekstene beholdes på originalspråket;
søk derfor primært på engelske navn eller vitenskapelige navn.

Historikken lagres automatisk med `localStorage` etter en kort skrivepause,
ved eksplisitt søk eller når du velger et treff/forlater søket. Den beholdes
mellom besøk i samme nettleser og filplassering. Privat nettlesing, sletting av
nettleserdata eller flytting av siden kan gjøre historikken utilgjengelig.
Hvis lokal lagring er blokkert/full, fungerer historikken for den åpne siden,
og «Siste søk» viser at den ikke kan lagres permanent.

## Eksempler

`A0C60#F02.A069M$F01.A04ZN`

| Del | Katalogbetydning |
| --- | --- |
| `A0C60` | Non-food animal-related matrices |
| `F02.A069M` | Part-nature: Liver (as part-nature) |
| `F01.A04ZN` | Source: Atlantic halibut (as animal) |

Altså lever fra atlantisk kveite, klassifisert som en ikke-mat-matrise.

`A01QS#F01.A04YE`: Animal fresh meat + Source: Rainbow trout (as animal),
altså ferskt kjøtt fra regnbueørret.

`#` skiller grunnkode fra fasetter, `.` skiller fasettkode fra termkode,
og `$` skiller flere fasetter.

## Datagrunnlag og oppdatering

`catalogue-data.js` er generert fra `MTX.xml`. Den inneholder alle termer,
termtekster, versjonsfelt, hierarkitilknytninger, implisitte attributter,
hierarkidefinisjoner og attributtdefinisjoner som brukes av visningen.
Kildens SHA-256 og katalogversjon vises under «Slik bruker du siden».

Ved endring av XML-filen, kjør med Python 3.11 eller nyere:

```sh
python3 build_catalogue.py
```

Skriptet bruker bare standardbiblioteket, og standardfilene finnes relativt
til skriptets plassering. Alternativ kilde og mål kan angis:

```sh
python3 build_catalogue.py /sti/til/MTX.xml --output catalogue-data.js
```

Last siden på nytt etter regenerering. En ferdig generert datafil følger med
slik at Python bare er nødvendig når katalogen oppdateres. Lokale klassiske
JavaScript-filer brukes i stedet for `fetch()` eller ES-moduler, som ofte
blokkeres ved `file://`. Ingen eksterne biblioteker, skrifttyper eller
nettverksforespørsler brukes. Kildelenker åpnes bare når du klikker på dem.

## Tolking og gyldighet

Kodetolkeren kontrollerer syntaks, eksistens av kodedeler og at fasettens term
tilhører riktig fasetthierarki. Ukjente eller feilplasserte deler gir tydelige
feil, mens øvrige deler fortsatt forklares. Duplikate fasettdeskriptorer og
utgåtte termer merkes.

Dette er et katalogoppslag, ikke en full implementasjon av EFSAs FoodEx2-
valideringsregler. Kombinasjonenes faglige gyldighet, motstridende fasetter,
rapporteringskrav og kardinalitet valideres ikke. XML-feltene `single` og
`repeatable` kan avvike fra fasettenes fritekstbeskrivelse; begge vises i
fasettoversikten uten å utlede en egen regel.

### Rapporterbarhet i kodetolkeren

Velg rapporteringshierarki under kodefeltet. Standard er katalogens
`defaultHierarchy=report` (Reporting hierarchy). Hver tolkning viser:

- **Rapporterbar etter katalogkontroll** når grunnkoden finnes og har
  `reportable=true` i valgt hierarki, alle eksplisitte fasetter har
  `reportable=true` i sine egne fasetthierarkier, syntaks/tilhørighet er riktig
  og termdatoene er gyldige i dag (UTC).
- **Ikke rapporterbar** med årsak ved feil, manglende grunnkode, manglende
  hierarkitilhørighet, `reportable=false`, utgåtte/ennå ikke gyldige termer
  eller en fasett-term brukt som grunnkode.
- **Kan ikke avgjøres med katalogkontrollen** ved manglende flagg eller flere
  eksplisitte verdier for samme fasett, som krever nærmere regelvurdering.

Kontrollen gjelder kodedelene, ikke en full faglig validering av kombinasjonen.
Implisitte fasetter, konflikter mellom egenskaper, kardinalitet og krav i en
bestemt datainnsamling valideres ikke. Alle delkontroller kan vises. Andre
hierarkier der koden består katalogkontrollen vises som klikkbare alternativer.
For eksempel består `A01QS#F01.A04YE` i `biomo` (Zoonoses hierarchy), men
ikke i `report`, fordi grunnkoden ikke finnes der.

Hierarkivelgeren bruker basehierarkier, med unntak av hierarkier merket
`notUsedHierarchies` og hierarkier hvis beskrivelse uttrykkelig sier at de ikke
er rapporteringshierarkier. MTX-hovedtreet brukes ikke som rapporteringshierarki.
Valgt hierarki følger med i historikken og enkeltkodelenker. Rapporterbarhet
og begrunnelse følger også med ved kopiering og CSV-eksport.

Implisitte fasetter fra `allFacets` (eller `implicitFacets` hvis førstnevnte
mangler) vises separat. De slås ikke automatisk sammen med eksplisitte
fasetter. En term merkes utgått når `validTo` er passert (dato, UTC), eller
status uttrykkelig angir at termen er inaktiv/utgått. Rapporterbarhet vises
per hierarki slik den er oppgitt i XML-en.

## Tester

Kjernelogikken kan testes mot den genererte katalogen med Node.js 18+:

```sh
node --test catalogue.test.cjs
```

Testene omfatter eksempelkoder, feilaktige koder, fasettilhørighet, implisitte
fasetter, søk, utgåtte termer og hierarkigrenser.
