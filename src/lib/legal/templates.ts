// src/lib/legal/templates.ts
// Πρότυπα νομικά κείμενα του δημόσιου site (ΕΛ/EN) — καθαρά δεδομένα.
//
// Ισχύουν όσο η εταιρία ΔΕΝ έχει αποθηκεύσει δικό της κείμενο. Είναι γενικά
// πρότυπα: στο dashboard φαίνονται ως «Πρότυπο — να ελεγχθεί από νομικό».
// Τα {{…}} γεμίζουν με τα στοιχεία της εταιρίας τη στιγμή της προβολής
// (fillPlaceholders, legal.ts) — και στα δικά της κείμενα.
//
// Αλλαγή κειμένου εδώ = νέο TEMPLATE_VERSION (και ημερομηνία), ώστε οι
// κρατήσεις να δείχνουν ποια έκδοση του προτύπου αποδέχτηκε ο πελάτης.

export const TEMPLATE_VERSION = "2026-10-21";
/** «Τελευταία ενημέρωση» του προτύπου (YYYY-MM-DD). */
export const TEMPLATE_UPDATED = "2026-10-21";

export const LEGAL_KINDS = ["terms", "privacy", "cookies"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

/** Γλώσσες με πρότυπο· οι άλλες παίρνουν το αγγλικό. */
export const TEMPLATE_LANGS = ["el", "en"] as const;

const terms_el = `# Όροι ενοικίασης

Οι παρόντες όροι ισχύουν για κάθε κράτηση που γίνεται μέσω αυτού του site με την εταιρία **{{company}}** (ΑΦΜ {{vat}}, {{address}}, email {{email}}, τηλέφωνο {{phone}}), στο εξής «η εταιρία». Με την αποδοχή τους κατά την κράτηση, ο πελάτης δηλώνει ότι τους διάβασε και τους αποδέχεται.

## 1. Κράτηση

- Η κράτηση ολοκληρώνεται με την υποβολή της φόρμας και την αποδοχή των όρων. Ο πελάτης λαμβάνει κωδικό κράτησης.
- Όταν η εταιρία λειτουργεί με αίτημα κράτησης, η κράτηση ισχύει μόνο αφού επιβεβαιωθεί από την εταιρία.
- Η εταιρία εγγυάται την κατηγορία του οχήματος («ή παρόμοιο») και όχι συγκεκριμένο μοντέλο.

## 2. Οδηγός

- Ο οδηγός πρέπει να έχει την ηλικία που ορίζεται στην κράτηση και έγκυρο δίπλωμα οδήγησης για την κατηγορία του οχήματος.
- Στην παραλαβή ζητείται ταυτότητα ή διαβατήριο και το δίπλωμα. Πρόσθετοι οδηγοί δηλώνονται και εγκρίνονται από την εταιρία.

## 3. Τιμή και πληρωμή

- Η τιμή που εμφανίζεται στην κράτηση περιλαμβάνει ΦΠΑ και τις επιλογές (πρόσθετα, ασφάλεια) που διάλεξε ο πελάτης.
- Η πληρωμή γίνεται με τον τρόπο που επιλέχθηκε στην κράτηση (στην παραλαβή ή online). Οι online πληρωμές γίνονται μέσω της Stripe· η εταιρία δεν βλέπει ούτε αποθηκεύει τα στοιχεία της κάρτας.
- Χρεώσεις όπως παράδοση/παραλαβή σε άλλο σημείο ή εκτός ωραρίου εμφανίζονται χωριστά πριν την ολοκλήρωση.

## 4. Αλλαγές και ακυρώσεις

- Για αλλαγή ή ακύρωση ο πελάτης επικοινωνεί με την εταιρία στο {{email}} ή στο {{phone}}, αναφέροντας τον κωδικό κράτησης.
- Τυχόν χρέωση ακύρωσης ή επιστροφή χρημάτων γίνεται σύμφωνα με την πολιτική που έχει ανακοινώσει η εταιρία κατά την κράτηση.

## 5. Χρήση του οχήματος

- Το όχημα παραδίδεται και επιστρέφεται στην κατάσταση και με το καύσιμο που καταγράφονται στο συμβόλαιο.
- Απαγορεύεται η οδήγηση υπό την επήρεια αλκοόλ ή ουσιών, η υπενοικίαση, η χρήση σε αγώνες και η μεταφορά με πλοίο χωρίς έγγραφη άδεια της εταιρίας.
- Κλήσεις, πρόστιμα και διόδια κατά τη διάρκεια της ενοικίασης βαραίνουν τον πελάτη.

## 6. Ασφάλεια και ζημιές

- Το όχημα καλύπτεται με την υποχρεωτική ασφάλιση αστικής ευθύνης. Πρόσθετες καλύψεις ισχύουν μόνο αν επιλέχθηκαν στην κράτηση, με τους όρους και τις εξαιρέσεις τους.
- Κάθε ατύχημα ή ζημιά δηλώνεται αμέσως στην εταιρία και, όπου απαιτείται, στις αρχές.

## 7. Τελικό συμβόλαιο

Κατά την παραλαβή υπογράφεται συμβόλαιο ενοικίασης. Σε περίπτωση διαφοράς υπερισχύουν οι όροι του υπογεγραμμένου συμβολαίου.

## 8. Δίκαιο και επικοινωνία

Εφαρμόζεται το ελληνικό δίκαιο. Για κάθε απορία: {{company}}, {{address}}, {{email}}, {{phone}}. Ο καταναλωτής μπορεί επίσης να απευθυνθεί στην πλατφόρμα επίλυσης διαφορών της ΕΕ: [ec.europa.eu/consumers/odr](https://ec.europa.eu/consumers/odr).
`;

const terms_en = `# Rental terms

These terms apply to every booking made through this site with **{{company}}** (VAT no. {{vat}}, {{address}}, email {{email}}, phone {{phone}}), hereinafter "the company". By accepting them when booking, the customer confirms they have read and accept them.

## 1. Booking

- A booking is made when the form is submitted and these terms are accepted. The customer receives a booking code.
- When the company works with booking requests, the booking is valid only once confirmed by the company.
- The company guarantees the vehicle category ("or similar"), not a specific model.

## 2. Driver

- The driver must be of the age stated in the booking and hold a valid driving licence for the vehicle category.
- An ID card or passport and the driving licence are requested at pick-up. Additional drivers must be declared and approved by the company.

## 3. Price and payment

- The price shown in the booking includes VAT and the options (extras, insurance) chosen by the customer.
- Payment is made as chosen in the booking (on pick-up or online). Online payments are processed by Stripe; the company does not see or store card details.
- Charges such as delivery/collection at another location or out-of-hours service are shown separately before the booking is completed.

## 4. Changes and cancellations

- To change or cancel, the customer contacts the company at {{email}} or {{phone}}, quoting the booking code.
- Any cancellation charge or refund follows the policy announced by the company at the time of booking.

## 5. Use of the vehicle

- The vehicle is handed over and returned in the condition and with the fuel recorded in the rental agreement.
- Driving under the influence of alcohol or drugs, subletting, racing and ferry transport without the company's written permission are prohibited.
- Traffic fines, penalties and tolls during the rental are the customer's responsibility.

## 6. Insurance and damage

- The vehicle carries the mandatory third-party liability insurance. Additional cover applies only if chosen in the booking, with its own terms and exclusions.
- Any accident or damage must be reported to the company immediately and, where required, to the authorities.

## 7. Rental agreement

A rental agreement is signed at pick-up. In case of discrepancy, the signed agreement prevails.

## 8. Law and contact

Greek law applies. For any question: {{company}}, {{address}}, {{email}}, {{phone}}. Consumers may also use the EU online dispute resolution platform: [ec.europa.eu/consumers/odr](https://ec.europa.eu/consumers/odr).
`;

const privacy_el = `# Πολιτική απορρήτου

Η εταιρία **{{company}}** (ΑΦΜ {{vat}}, {{address}}, email {{email}}) είναι υπεύθυνη επεξεργασίας για τα προσωπικά δεδομένα που δίνετε σε αυτό το site, σύμφωνα με τον Γενικό Κανονισμό Προστασίας Δεδομένων (ΕΕ) 2016/679 και τον ν. 4624/2019.

## Ποια δεδομένα συλλέγουμε

- Στοιχεία κράτησης: ονοματεπώνυμο, email, τηλέφωνο, ημερομηνία γέννησης, αριθμό πτήσης (όπου χρειάζεται) και τα σχόλιά σας.
- Στοιχεία ενοικίασης: ημερομηνίες, σημεία παραλαβής/επιστροφής, επιλογές και τιμή.
- Πληρωμή: οι online πληρωμές γίνονται απευθείας στη Stripe. Η εταιρία λαμβάνει μόνο το αποτέλεσμα της πληρωμής, όχι τα στοιχεία της κάρτας.

## Γιατί και με ποια νομική βάση

- Για να εκτελέσουμε την κράτηση και τη σύμβαση ενοικίασης (άρθρο 6 παρ. 1 β ΓΚΠΔ).
- Για τις φορολογικές και λογιστικές μας υποχρεώσεις (άρθρο 6 παρ. 1 γ ΓΚΠΔ).
- Για την ασφάλεια του site και την αποτροπή κατάχρησης, π.χ. όρια υποβολών (άρθρο 6 παρ. 1 στ ΓΚΠΔ).

Δεν χρησιμοποιούμε τα δεδομένα σας για διαφήμιση και δεν τα πουλάμε.

## Σε ποιους τα δίνουμε

Μόνο σε όσους χρειάζεται για την κράτηση: στον πάροχο της πλατφόρμας κρατήσεων και της φιλοξενίας (ως εκτελούντες την επεξεργασία), στη Stripe για τις online πληρωμές, στον πάροχο αποστολής email, και σε δημόσιες αρχές όταν το προβλέπει ο νόμος.

## Πόσο καιρό τα κρατάμε

Όσο χρειάζεται για την ενοικίαση και στη συνέχεια για όσο ορίζει η φορολογική και λογιστική νομοθεσία. Κρατήσεις που δεν ολοκληρώθηκαν διαγράφονται όταν δεν χρειάζονται πλέον.

## Τα δικαιώματά σας

Έχετε δικαίωμα πρόσβασης, διόρθωσης, διαγραφής, περιορισμού, φορητότητας και εναντίωσης. Για να τα ασκήσετε γράψτε στο {{email}}. Μπορείτε επίσης να υποβάλετε καταγγελία στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα ([www.dpa.gr](https://www.dpa.gr)).

## Cookies

Για τα cookies και την τοπική αποθήκευση του site δείτε την Πολιτική cookies.
`;

const privacy_en = `# Privacy policy

**{{company}}** (VAT no. {{vat}}, {{address}}, email {{email}}) is the data controller for the personal data you provide on this site, under the General Data Protection Regulation (EU) 2016/679 and Greek Law 4624/2019.

## What we collect

- Booking details: full name, email, phone, date of birth, flight number (where needed) and your comments.
- Rental details: dates, pick-up/return locations, options and price.
- Payment: online payments are made directly with Stripe. The company only receives the payment result, never your card details.

## Why and on what legal basis

- To perform your booking and the rental contract (Art. 6(1)(b) GDPR).
- To meet our tax and accounting obligations (Art. 6(1)(c) GDPR).
- To keep the site secure and prevent abuse, e.g. submission limits (Art. 6(1)(f) GDPR).

We do not use your data for advertising and we do not sell it.

## Who we share it with

Only those needed for your booking: the provider of the booking platform and hosting (as processors), Stripe for online payments, the email delivery provider, and public authorities where the law requires.

## How long we keep it

For as long as needed for the rental and then for the period required by tax and accounting law. Bookings that did not go ahead are deleted when no longer needed.

## Your rights

You have the right of access, rectification, erasure, restriction, portability and objection. To exercise them, write to {{email}}. You may also lodge a complaint with the Hellenic Data Protection Authority ([www.dpa.gr](https://www.dpa.gr)).

## Cookies

For cookies and local storage on this site, see the Cookie policy.
`;

const cookies_el = `# Πολιτική cookies

Αυτή η σελίδα εξηγεί τι αποθηκεύει το site της εταιρίας **{{company}}** στη συσκευή σας.

## Cookies του site

Το site **δεν τοποθετεί cookies** και δεν χρησιμοποιεί εργαλεία στατιστικών, διαφήμισης ή παρακολούθησης. Γι' αυτό δεν σας ζητάμε συγκατάθεση.

## Τοπική αποθήκευση (απολύτως απαραίτητη)

- **sf-book-draft** (sessionStorage): κρατά προσωρινά τα στοιχεία της φόρμας κράτησης όσο είναι ανοιχτή η καρτέλα, ώστε να μη χαθούν αν ανανεώσετε τη σελίδα. Σβήνεται με την υποβολή ή όταν κλείσετε την καρτέλα. Δεν στέλνεται πουθενά.

## Υπηρεσίες τρίτων

- **Online πληρωμή (Stripe):** αν επιλέξετε online πληρωμή, μεταφέρεστε στη σελίδα πληρωμής της Stripe (checkout.stripe.com). Εκεί η Stripe χρησιμοποιεί δικά της απαραίτητα cookies για την πληρωμή και την πρόληψη απάτης, σύμφωνα με την [πολιτική της](https://stripe.com/cookies-policy/legal).
- **Φωτογραφίες και λογότυπο:** φορτώνονται από το Cloudinary και τον χώρο αποθήκευσης της πλατφόρμας, χωρίς cookies.
- **Google:** οι κριτικές Google διαβάζονται από τον server μας· ο browser σας δεν επικοινωνεί με τη Google. Τα links «Χάρτης» ανοίγουν το Google Maps μόνο αν τα πατήσετε.

## Επικοινωνία

Για απορίες: {{email}}.
`;

const cookies_en = `# Cookie policy

This page explains what the site of **{{company}}** stores on your device.

## Cookies set by this site

This site **does not set cookies** and does not use analytics, advertising or tracking tools. That is why we do not ask for your consent.

## Local storage (strictly necessary)

- **sf-book-draft** (sessionStorage): temporarily keeps the booking form details while the tab is open, so they are not lost if you reload the page. It is deleted when you submit or close the tab. It is not sent anywhere.

## Third-party services

- **Online payment (Stripe):** if you choose to pay online, you are taken to Stripe's payment page (checkout.stripe.com). There Stripe uses its own strictly necessary cookies for payment and fraud prevention, under [its policy](https://stripe.com/cookies-policy/legal).
- **Photos and logo:** loaded from Cloudinary and the platform's file storage, without cookies.
- **Google:** Google reviews are read by our server; your browser does not contact Google. "Map" links open Google Maps only if you tap them.

## Contact

For questions: {{email}}.
`;

export const LEGAL_TEMPLATES: Record<LegalKind, Record<(typeof TEMPLATE_LANGS)[number], string>> = {
  terms: { el: terms_el, en: terms_en },
  privacy: { el: privacy_el, en: privacy_en },
  cookies: { el: cookies_el, en: cookies_en },
};

export function legalTemplate(kind: LegalKind, lang: string): string {
  return lang === "el" ? LEGAL_TEMPLATES[kind].el : LEGAL_TEMPLATES[kind].en;
}
