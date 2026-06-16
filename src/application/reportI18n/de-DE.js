/**
 * Deutsch (Deutschland). Siehe pt-BR.js für die Struktur von `ctx`.
 */
export default {
  htmlLang: "de-DE",
  localeCode: "de-DE",
  decimal: ",",

  files: {
    reportsDir: "berichte",
    reportPrefix: "bericht",
    list: {
      "com-site": { file: "mit-website", label: "Mit Website" },
      "sem-site": { file: "ohne-website", label: "Ohne Website" },
    },
  },

  cta: {
    type: "email",
    subject: "Anfrage zur Website-Vorschau",
    message: "Hallo! Ich komme über den Bericht und würde gerne die Vorschau der Website sehen, die Ihr Team für mich erstellt hat!",
  },

  strings(ctx) {
    const { notaDisp, reviews, band, perdaEm10, score10, tag } = ctx;
    const reviewsTxt = reviews ? String(reviews) : "zahlreichen";

    const resumo = {
      low: {
        r1: `Ihre Website lässt Geld liegen. Die gute Nachricht: Das Problem ist nicht Ihr Geschäft — es ist das digitale Schaufenster, und das lässt sich schnell beheben.`,
        r2: `Ihre Bewertung von ${notaDisp}★ mit ${reviewsTxt} Rezensionen zählt Sie zu den bestbewerteten Unternehmen in Ihrer Region. Doch wer auf Ihre Website klickt, findet ein Erlebnis, das dieser Qualität nicht entspricht — und geht, bevor er kauft.`,
      },
      mid: {
        r1: `Ihre Website funktioniert, schöpft aber ihr Potenzial bei Weitem nicht aus. Es gibt klare Schwachstellen, deren Behebung Conversions freisetzt, die Ihnen heute entgehen.`,
        r2: `Mit ${notaDisp}★ und ${reviewsTxt} Rezensionen ziehen Sie genau die richtigen Kunden an. Die folgenden Korrekturen sorgen dafür, dass sie nicht auf halbem Weg abspringen.`,
      },
      high: {
        r1: `Ihre Website ist technisch in gutem Zustand — was selten ist. Dennoch gibt es Feinheiten, die eine "gute" Website von einer unterscheiden, die wie von selbst verkauft.`,
        r2: `Ihr Ruf (${notaDisp}★, ${reviewsTxt} Rezensionen) und eine solide Website sind eine starke Kombination. Lassen Sie uns verstärken, was bereits funktioniert.`,
      },
    }[band];

    return {
      reviewsFallback: "zahlreichen",
      outOf10: `von 10`,
      tagline: `Audit der digitalen Präsenz`,
      kickerAudit: `Audit`,
      footerPrefix: `Audit erstellt am`,
      overall: `Gesamtergebnis`,
      secRepVsSite: `Ihr Ruf vs. Ihre Website`,
      whatBuilt: `Was Sie aufgebaut haben`,
      googleRating: `Google-Bewertung`,
      numReviews: `Anzahl der Rezensionen`,
      reputation: `Reputation`,
      whatClientFinds: `Was der Kunde vorfindet`,
      secDiagnosis: `Diagnose Punkt für Punkt`,
      secCost: `Was Sie das kostet`,
      conservativeEst: `Konservative Schätzung`,
      nextStep: `Nächster Schritt`,
      ctaRebuild: `Die überarbeitete Version ansehen`,

      grade: { ok: `Gut`, warn: `Verbesserungsbedarf`, red: `Kritisch`, none: `Keine Daten` },
      rank: {
        best: `Unter den Besten`,
        veryGood: `Sehr gut bewertet`,
        good: `Gut bewertet`,
        rated: `Bewertet`,
      },
      contraste: {
        tempoCarregar: `Ladezeit`,
        notaPerf: `Performance-Wert`,
        respInteragir: `Reaktion bei Berührung`,
      },

      subtitle: `Sie haben sich einen Ruf aufgebaut, den nur wenige Mitbewerber haben: ${notaDisp}★ mit ${reviewsTxt} Rezensionen. Dieser Bericht zeigt Punkt für Punkt, warum Ihre Website diesen Ruf noch nicht in Kunden verwandelt — und was sich ändert, wenn sie der Qualität Ihres Service endlich gerecht wird.`,
      resumo1: resumo.r1,
      resumo2: resumo.r2,

      impactoDestaque:
        score10 >= 8
          ? `Ihre Website hält fast jeden Kunden, den Ihr Ruf anzieht — und es gibt noch Luft nach oben.`
          : `Von je 10 Kunden, die Ihre Website über Google öffnen, geben rund <strong style="color:var(--accent);">${perdaEm10}</strong> auf, bevor sie Ihr Angebot sehen.`,
      impactoTexto: `Beachten Sie: Es ist kein Mangel an Nachfrage — Ihr Ruf beweist, dass die Nachfrage da ist. Es ist das Website-Erlebnis, das den Verkauf im letzten Schritt blockiert. Diesen Anteil zurückzugewinnen erfordert keine höheren Werbeausgaben; es erfordert eine Website, die Ihres Service würdig ist.`,

      proximoTitulo: `Ihre Website kann so gut arbeiten, wie Sie Ihre Kunden bedienen.`,
      proximoTexto: `Wir bauen Ihre digitale Präsenz neu auf, damit sie im Handumdrehen lädt, auf dem Handy einwandfrei funktioniert und Ihren Ruf in Buchungen und Verkäufe verwandelt. So könnte Ihre Website aussehen.`,

      dims: {
        lcp: {
          title: `Ladegeschwindigkeit`,
          unit: `erste Ansicht auf dem Handy`,
          explain:
            tag.lcp === "ok"
              ? `Ihre Website zeigt ihren Hauptinhalt in <strong>${ctx.lcpDisp}</strong> — innerhalb des von Google empfohlenen Bereichs. Das ist ein Pluspunkt: Der Kunde, der klickt, wartet nicht, und der durch Ihren Ruf entstandene Kaufimpuls bleibt erhalten.`
              : `Ihre Website braucht <strong>${ctx.lcpDisp}</strong>, um den Hauptinhalt auf dem Handy anzuzeigen. Google hat belegt, dass jenseits von 3 Sekunden mehr als die Hälfte der Menschen aufgibt, bevor die Seite überhaupt öffnet. In der Praxis: Sie haben ${reviewsTxt} Rezensionen und eine Bewertung von ${notaDisp} — kaufbereite Kunden klicken auf Ihre Website und treffen auf einen noch leeren Bildschirm. Das ist heute wahrscheinlich der größte Verlustfaktor Ihres Online-Geschäfts.`,
        },
        tbt: {
          title: `Reaktion auf Berührung`,
          unit: `eingefrorene Zeit`,
          explain:
            tag.tbt === "ok"
              ? `Beim Antippen von Schaltflächen und beim Scrollen reagiert die Website sofort. Diese Geschmeidigkeit vermittelt dasselbe Vertrauen wie Ihre Rezensionen.`
              : `Wenn der Kunde versucht, eine Schaltfläche anzutippen oder zu scrollen, friert die Website für <strong>${ctx.tbtDisp}</strong> ein. Dieses "hängende" Gefühl lässt das Geschäft fragil oder veraltet wirken — das genaue Gegenteil des Vertrauens, das Ihre ${reviewsTxt} Rezensionen erarbeitet haben.`,
        },
        cls: {
          title: `Visuelle Stabilität`,
          unit: `Layout-Verschiebung`,
          explain:
            tag.cls === "ok"
              ? `Die Elemente bleiben an Ort und Stelle, während die Seite lädt. Der Kunde klickt genau dorthin, wo er möchte, ohne Fehler — ein Erlebnis, das dem Verkauf nicht im Weg steht.`
              : `Während die Seite lädt, "springen" Elemente umher (Index ${ctx.clsDisp}). Der Kunde will auf "buchen" oder "kaufen" tippen und tippt am Ende auf etwas anderes. Diese wiederholte Frustration bringt viele dazu, die Website einfach zu schließen.`,
        },
        seo: {
          title: `Bei Google gefunden werden`,
          unit: `SEO-Wert /100`,
          explain:
            tag.seo === "ok"
              ? `Ihre Website ist gut für Google strukturiert. Das hilft Ihnen, auch bei Menschen aufzutauchen, die nach Ihrem Service suchen, nicht nur auf Maps.`
              : `Ihr SEO liegt bei <strong>${ctx.seo}/100</strong>. Derzeit hängen Sie fast vollständig von Google Maps ab, um gefunden zu werden. Eine gut strukturierte Website erfasst auch Menschen, die Ihren Service bei Google eingeben — neue Kunden, die in diesem Moment direkt zum Wettbewerber gehen, der vor Ihnen erscheint.`,
        },
        a11y: {
          title: `Erlebnis und Barrierefreiheit`,
          unit: `Barrierefreiheit /100`,
          explain:
            tag.a11y === "ok"
              ? `Ihre Website ist auf jedem Bildschirm leicht zu lesen und zu bedienen. Da die meisten Kunden vom Handy aus zugreifen, zählt das stark zu Ihren Gunsten.`
              : `Die Barrierefreiheit liegt bei <strong>${ctx.a11y}/100</strong> — sie misst, wie leicht die Website zu lesen und zu bedienen ist (Kontrast, Textgröße, mobile Navigation). Ein großer Teil Ihrer Kunden erreicht Sie über das Handy, oft unterwegs; Probleme hier vertreiben genau die Menschen, die jetzt kaufbereit sind.`,
        },
        bp: {
          title: `Vertrauen und Sicherheit`,
          unit: `Best Practices /100`,
          explain:
            tag.bp === "ok"
              ? `Ihre Website folgt modernen Sicherheits- und Qualitätsstandards. Das Schloss-Symbol für "sichere Website" vermittelt Glaubwürdigkeit schon in der ersten Sekunde.`
              : `Die Best Practices liegen bei <strong>${ctx.bp}/100</strong> — Sicherheit und moderne Standards (HTTPS, korrekte Bilder, keine Fehler). Eine "nicht sicher"-Warnung oder ein sichtbarer Fehler zerstört in Sekunden das Vertrauen, das Ihr Ruf über Jahre aufgebaut hat.`,
        },
      },
    };
  },
};
