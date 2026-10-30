"""Recursive-descent 68000 disassembler over a raw memory image.

usage: trace68k.py MEM.bin OUT.asm ENTRY [ENTRY...] [--range LO HI]
Follows branches/calls from each entry, then writes a listing where
code is disassembled and everything else is dumped as dc.b.
"""
import re
import sys
from collections import defaultdict

import capstone

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from dis68k import note  # noqa: E402

# calls followed by inline data: words up to and including the first negative one
# (sub_6C8DA: animation list; code resumes after it)
INLINE_DATA_CALLS = {0x6C8DA}

BRANCH = re.compile(r"^(b(ra|sr|hi|ls|cc|cs|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)|db\w+)")
STOP = {"rts", "rte", "rtr", "bra", "jmp", "illegal", "stop"}


def target(ins):
    """Return the code address an instruction transfers to, if static."""
    ops = ins.op_str
    m = None
    if BRANCH.match(ins.mnemonic):
        m = re.search(r"\$([0-9a-f]+)$", ops)
    elif ins.mnemonic in ("jsr", "jmp"):
        m = re.fullmatch(r"\$([0-9a-f]+)(\.[lw]|\(pc\))?", ops)
    return int(m.group(1), 16) if m else None


def main():
    args = sys.argv[1:]
    lo, hi = 0, None
    if "--range" in args:
        i = args.index("--range")
        lo, hi = int(args[i + 1], 0), int(args[i + 2], 0)
        del args[i:i + 3]
    mem = open(args[0], "rb").read()
    hi = hi or len(mem)
    out, entries = args[1], [int(a, 0) for a in args[2:]]

    md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_M68K_000)
    code = {}               # addr -> insn
    labels = {}             # addr -> name
    xrefs = defaultdict(set)
    hw = defaultdict(set)
    for e in entries:
        labels[e] = "entry_%05X" % e
    work = list(entries)

    def plausible(addr):
        """Does addr start a run of 8 cleanly decodable instructions?"""
        pc = addr
        for _ in range(8):
            ins = next(md.disasm(mem[pc:pc + 10], pc), None)
            if ins is None:
                return False
            if ins.mnemonic.split(".")[0] in STOP:
                return True
            pc += ins.size
        return True

    while True:
        trace_from(work, md, mem, lo, hi, code, labels, xrefs, hw)
        # code pointers loaded as constants (handlers, jump tables)
        work = []
        for ins in list(code.values()):
            if ins.mnemonic.split(".")[0] not in ("move", "lea", "pea", "movea"):
                continue
            for m in re.finditer(r"#?\$([0-9a-f]{5})(\.l)?\b", ins.op_str):
                t = int(m.group(1), 16)
                if lo <= t < hi and t % 2 == 0 and t not in code and plausible(t):
                    labels.setdefault(t, "ptr_%05X" % t)
                    xrefs[t].add(ins.address)
                    work.append(t)
        if not work:
            break
    write_listing(out, entries, mem, lo, hi, code, labels, xrefs)
    covered = set()
    for a, ins in code.items():
        covered.update(range(a, a + ins.size))
    print("instructions:", len(code), "labels:", len(labels))
    print("code bytes: %d of %d" % (len(covered), hi - lo))
    print("hardware registers touched:")
    for k in sorted(hw, key=lambda k: -len(hw[k]))[:25]:
        print("  %-22s %d sites" % (k, len(hw[k])))


def trace_from(work, md, mem, lo, hi, code, labels, xrefs, hw):
    while work:
        pc = work.pop()
        while lo <= pc < hi and pc not in code and pc % 2 == 0:
            ins = next(md.disasm(mem[pc:pc + 10], pc), None)
            if ins is None:
                break
            code[pc] = ins
            for r in re.findall(r"\$(dff[0-9a-f]{3})", ins.op_str):
                hw[note("$" + r)[2:]].add(pc)
            t = target(ins)
            if t is not None and lo <= t < hi:
                kind = "sub" if ins.mnemonic in ("bsr", "bsr.b", "bsr.w", "jsr") else "loc"
                if labels.get(t, "").startswith(("sub", "entry")):
                    pass
                else:
                    labels[t] = "%s_%05X" % (kind, t)
                xrefs[t].add(pc)
                work.append(t)
            if ins.mnemonic.split(".")[0] in STOP:
                break
            pc += ins.size
            if t in INLINE_DATA_CALLS:
                while pc + 2 <= hi and mem[pc] < 0x80:
                    pc += 2
                pc += 2


def write_listing(out, entries, mem, lo, hi, code, labels, xrefs):
    covered = set()
    for a, ins in code.items():
        covered.update(range(a, a + ins.size))
    with open(out, "w") as f:
        f.write("; Silkworm (Amiga) - traced disassembly from %s\n" % ", ".join("$%X" % e for e in entries))
        f.write("; %d instructions, %d labels\n\n" % (len(code), len(labels)))
        a = lo
        while a < hi:
            if a in labels:
                refs = " ".join("$%X" % r for r in sorted(xrefs[a])[:6])
                f.write("\n%s:%s\n" % (labels[a], ("  ; from " + refs) if refs else ""))
            if a in code:
                ins = code[a]
                ops = ins.op_str
                t = target(ins)
                if t in labels:
                    ops = re.sub(r"\$%x(\.[lw]|\(pc\))?$" % t, labels[t], ops)
                f.write("%06X  %-8s %-34s %s\n" % (a, ins.mnemonic, ops, note(ins.op_str)))
                a += ins.size
                continue
            # data run up to next code/label
            # (always take at least one byte: a pointer may land mid-instruction)
            end = a + 1
            while end < hi and end not in covered and end not in labels and end - a < 16:
                end += 1
            chunk = mem[a:end]
            txt = "".join(chr(c) if 32 <= c < 127 else "." for c in chunk)
            f.write("%06X  dc.b     %-48s ; %s\n" % (a, " ".join("%02x" % c for c in chunk), txt))
            a = end


if __name__ == "__main__":
    main()
