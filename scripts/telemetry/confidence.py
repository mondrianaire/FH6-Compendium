#!/usr/bin/env python3
"""confidence.py -- decide whether a detected fault has earned the right to be stated.

THE RULE. It is always better to need more laps than to conclude from too few. So nothing here
returns "understeer at T5". It returns one of three verdicts, and two of them are not advice:

    REPORT        the evidence clears every gate; say it, with the interval it was earned on
    WATCHING      the fault is real enough to show as an observation, but not to tune against;
                  the finding carries how many more passes would settle it
    INSUFFICIENT  we do not know yet; the finding carries how many more laps would decide it
    NOT_RECURRENT we DO know: enough passes, and the fault is too rare to be a tuning target

The last two are the distinction this module exists to keep. "Seen twice in sixty-one passes" and
"seen twice in four passes" are both below the floor and they mean opposite things -- the first is a
settled negative that no further driving will change, the second is ignorance. Collapsing them into
one "not enough data" bucket is the same error as over-claiming, pointed the other way: it hides a
finished answer and invites the driver to go and gather data that cannot change anything.

A WATCHING finding must never be phrased as a recommendation anywhere downstream. That is the whole
point of the module: the failure mode it exists to prevent is a confident sentence built on four laps.

WHY A POINT ESTIMATE IS A LIE HERE. Measured 2026-09-18 on the densest cell we own (Edamame, the
Exocet, 61 clean laps on one build and one tune): of the 45 (symptom, turn) pairs that fire at all,
19 fire on 10% of laps or fewer and only one exceeds 70%. The bulk sit between 20% and 60%. So the
typical fault is INTERMITTENT, and "T5 pushes" is a claim about a coin that lands heads a third of
the time. Three laps of such a turn return 0, 1, 2 or 3 hits with probabilities 30/44/22/4 percent
-- every outcome is ordinary, so no reading of three laps carries information. The honest statement
is an interval, and the honest claim is its LOWER bound: not "pushes 40% of the time" but "pushes on
at least 22% of passes, 95% confident".

THE TRIAL IS A PASS, NOT A LAP. A turn-local fault gets one trial per pass of THAT turn. Edamame has
11 turns, so three laps is three trials per turn, not thirty-three. Sample size accrues far more
slowly than lap count suggests, and every "needs N more" figure here is in laps of the course that
contains the turn, converted at passes_per_lap, because laps are what the driver actually does.

TWO EVIDENCE CLASSES, BECAUSE NOT EVERY FAULT IS STATISTICAL.

  DETERMINISTIC  the physics is unambiguous in a single sample and the reading cannot be a fluke:
                 the suspension was on its stop, top gear was never reached, the wheels locked at
                 full pedal. One occurrence proves the occurrence. These report at n=1, which is
                 Jett's standing directive that bottoming raises the flag immediately rather than
                 waiting for a sample -- and it is sound, because the detector is not estimating a
                 rate, it is reading a stop.
  STATISTICAL    the fault is a tendency, not an event: understeer, oversteer, instability. A single
                 pass showing it proves nothing, because the driver also varies. These are gated.

A deterministic fault still reports its RATE, because "bottomed once in 40 laps over one kerb" and
"bottoms every lap" call for different sized fixes. The class decides whether it may speak, not how
loudly.

THE DRIVER CONFOUND. A fault that only appears when the corner was entered fast is a driving
mistake, not a tune fault, and recommending a spring change for it makes the car worse. So a
statistical finding is also tested against entry speed: if the passes that show the fault are
systematically faster than the passes that do not, the finding is tagged driver_linked and demoted.
The test is deliberately crude -- a standardised mean difference on entry speed, not a model --
because the decision it feeds is binary and a crude test that is understood beats a subtle one that
is not.

THRESHOLDS ARE HERE, NOT BURIED, AND EVERY ONE IS A JUDGEMENT.
"""
import math

Z95 = 1.959963984540054          # two-sided 95%; every interval in this module is 95%

N_MIN_STATISTICAL = 8            # passes below which a tendency is not discussed at all. 8 passes of one
                                 # turn is under a lap of most courses' worth of that turn, and the Wilson
                                 # lower bound at 8/8 is still only 0.63 -- so this is a floor, not a target
N_MIN_DETERMINISTIC = 1          # a stop is a stop
P_FLOOR = 0.20                   # the lower bound a tendency must clear to be called recurrent. Under a
                                 # fifth of passes is inside ordinary driver variation on the measured corpus
WIDTH_MAX = 0.40                 # a 95% interval wider than this spans "occasional" to "constant" and cannot
                                 # size a fix, however good its lower bound
SMD_DRIVER = 0.80                # standardised entry-speed difference above which the fault tracks how fast
                                 # the corner was entered rather than the tune (Cohen's "large")
SEVERE = 0.85                    # a deterministic fault this severe reports on one occurrence regardless of rate

REPORT, WATCHING, INSUFFICIENT, NOT_RECURRENT = (
    "report", "watching", "insufficient", "not_recurrent")


def wilson(k, n, z=Z95):
    """The Wilson score interval for k successes in n trials.

    Wilson rather than the textbook normal interval because every interesting case here is small n
    or a proportion near 0, exactly where the normal interval returns bounds below zero and claims
    certainty it has not got. At k=0 Wilson still returns a sane upper bound, which is what lets
    "never seen in 20 passes" mean something.
    """
    if n <= 0:
        return (0.0, 1.0)
    # TOTAL BY CONSTRUCTION. k > n is arithmetically impossible for a proportion and yet it reaches
    # here from real data: diag_event.container is attributed through the analyzer's ctx(), which
    # takes the FIRST lap of a session for that car, so a container can collect more affected laps
    # than it has laps of its own. Raising would take the whole dashboard build down over one
    # mis-attributed row -- observed 2026-09-18, build_web died on p = 2.04. Clamping keeps the
    # interval honest (it can only ever say "all of them") and leaves the mis-attribution to be
    # fixed where it is caused rather than where it is noticed.
    k = min(max(k, 0), n)
    p = k / n
    d = 1.0 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (max(0.0, (c - h) / d), min(1.0, (c + h) / d))


def needed_n(k, n, floor=P_FLOOR, width=WIDTH_MAX, z=Z95, cap=400):
    """How many trials in total would settle this, if the observed rate holds.

    Answers the question the driver actually asks -- "how many more laps?" -- by assuming the rate
    seen so far is the true one and finding the smallest n whose interval both clears the floor and
    is narrow enough. Returns None when the observed rate is too low to ever clear the floor, which
    is the honest answer for a fault seen twice in sixty passes: more laps will not make it real.
    """
    if n <= 0:
        return None
    p = min(max(k, 0), n) / n
    for m in range(max(n, 1), cap + 1):
        km = p * m
        lo, hi = wilson(km, m, z)
        if lo >= floor and (hi - lo) <= width:
            return m
    return None


def smd(a, b):
    """Standardised mean difference between two samples; 0.0 when either is too small to judge."""
    if len(a) < 3 or len(b) < 3:
        return 0.0
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    va = sum((x - ma) ** 2 for x in a) / (len(a) - 1)
    vb = sum((x - mb) ** 2 for x in b) / (len(b) - 1)
    sp = math.sqrt(((len(a) - 1) * va + (len(b) - 1) * vb) / (len(a) + len(b) - 2))
    return 0.0 if sp <= 1e-9 else (ma - mb) / sp


def assess(k, n, evidence_class="statistical", severity=None,
           hit_entry_mph=None, miss_entry_mph=None, passes_per_lap=1.0):
    """Judge one (symptom, turn) pair. Returns a dict a UI can render without further thinking.

    k                  passes showing the fault
    n                  passes of that turn on this build+tune
    evidence_class     "deterministic" or "statistical"
    severity           0..1 from the detector, used only for the deterministic severe path
    hit/miss_entry_mph entry speeds of the passes that did and did not show it, for the driver test
    passes_per_lap     trials gained per lap, so "more laps" is in the driver's own unit
    """
    det = evidence_class == "deterministic"
    k = min(max(k, 0), n) if n > 0 else max(k, 0)        # see wilson(): k > n arrives from real data
    lo, hi = wilson(k, n)
    out = {
        "k": k, "n": n, "rate": (k / n) if n else 0.0,
        "lo": round(lo, 3), "hi": round(hi, 3), "width": round(hi - lo, 3),
        "evidence_class": evidence_class, "driver_linked": False, "why": "",
        "needs_laps": None,
    }
    if k <= 0:
        # Never seen. With enough passes that is a real negative, not ignorance.
        out["verdict"] = NOT_RECURRENT if n >= N_MIN_STATISTICAL else INSUFFICIENT
        out["why"] = "never observed in %d passes" % n
        if out["verdict"] == INSUFFICIENT:
            out["needs_laps"] = _laps(N_MIN_STATISTICAL, n, passes_per_lap)
        return out

    n_min = N_MIN_DETERMINISTIC if det else N_MIN_STATISTICAL

    # The driver test, statistical faults only: a tendency that tracks entry speed is the driver's.
    if not det and hit_entry_mph and miss_entry_mph:
        d = smd(hit_entry_mph, miss_entry_mph)
        if d >= SMD_DRIVER:
            out["driver_linked"] = True
            out["entry_smd"] = round(d, 2)

    if n < n_min:
        out["verdict"] = INSUFFICIENT
        need = needed_n(k, n)
        out["needs_laps"] = _laps(need, n, passes_per_lap) if need else _laps(n_min, n, passes_per_lap)
        out["why"] = "%d passes; %d is the floor for a %s fault" % (n, n_min, evidence_class)
        return out

    # A deterministic fault at full severity is a physical event, not a rate: say it on one.
    if det and (severity is not None and severity >= SEVERE):
        out["verdict"] = REPORT
        # Phrased for the CLASS, not for bottoming. "the reading is a stop" was written when
        # bottoming was the only deterministic detector and read as nonsense the moment gearing
        # produced it: top gear is not a stop.
        out["why"] = ("severity %.2f on %d of %d passes; a physical state read from the signal, "
                      "not a rate estimated from a sample" % (severity, k, n))
        return out

    if out["driver_linked"]:
        out["verdict"] = WATCHING
        need = needed_n(k, n)
        out["needs_laps"] = _laps(need, n, passes_per_lap)
        out["why"] = ("entry speed on the passes that show it is %.2f SD higher than on those that "
                      "do not -- this tracks how the corner was entered, not the tune"
                      % out.get("entry_smd", 0.0))
        return out

    if lo < P_FLOOR:
        # needed_n is None when the observed rate is too low for ANY number of laps to clear the
        # floor. That is a settled answer, so it must not be dressed up as missing data.
        need = needed_n(k, n)
        out["needs_laps"] = _laps(need, n, passes_per_lap)
        if need is None:
            out["verdict"] = WATCHING if det else NOT_RECURRENT
            out["why"] = ("%d of %d passes, at most %.0f%%; too rare to tune against, and at this "
                          "rate no number of laps would change that" % (k, n, hi * 100))
        else:
            out["verdict"] = WATCHING if det else INSUFFICIENT
            out["why"] = ("%d of %d passes; at least %.0f%% is all that can be claimed, under the "
                          "%.0f%% floor -- about %s more laps would decide it"
                          % (k, n, lo * 100, P_FLOOR * 100, out["needs_laps"]))
        return out

    if (hi - lo) > WIDTH_MAX:
        out["verdict"] = WATCHING
        need = needed_n(k, n)
        out["needs_laps"] = _laps(need, n, passes_per_lap)
        out["why"] = ("%d of %d passes; the interval %.0f-%.0f%% is too wide to size a fix"
                      % (k, n, lo * 100, hi * 100))
        return out

    out["verdict"] = REPORT
    out["why"] = "%d of %d passes; at least %.0f%% of the time, 95%% confident" % (k, n, lo * 100)
    return out


def _laps(target_n, have_n, passes_per_lap):
    """Extra LAPS to reach target_n passes. None stays None: 'no number of laps' is an answer."""
    if target_n is None or passes_per_lap <= 0:
        return None
    return max(0, math.ceil((target_n - have_n) / passes_per_lap))


def phrase(a, what, where=None):
    """One sentence, in the register the verdict earns. Downstream must not re-word a WATCHING."""
    at = (" at %s" % where) if where else ""
    if a["verdict"] == REPORT:
        return "%s%s on at least %.0f%% of passes (%d of %d)." % (
            what, at, a["lo"] * 100, a["k"], a["n"])
    if a["verdict"] == WATCHING:
        tail = ("; %d more laps would settle it" % a["needs_laps"]) if a["needs_laps"] else ""
        return "Watching: %s%s, %d of %d passes so far%s. Not a tuning recommendation yet." % (
            what.lower(), at, a["k"], a["n"], tail)
    if a["verdict"] == NOT_RECURRENT:
        return "Ruled out: %s%s on only %d of %d passes -- settled, not a tuning target." % (
            what.lower(), at, a["k"], a["n"])
    tail = ("; needs about %d more laps" % a["needs_laps"]) if a["needs_laps"] else ""
    return "Not enough data on %s%s (%d of %d passes)%s." % (what.lower(), at, a["k"], a["n"], tail)
