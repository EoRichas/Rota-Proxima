"""Road-based ordering for an open route, including appointments and service time.

The matrix is directed: reversing a segment does not assume identical return roads.
No inaccessible road segment is ever priced as zero.
"""
import math


def edge(matrix, a, b):
    value = matrix[a][b]
    return float(value) if value is not None and math.isfinite(float(value)) and value >= 0 else math.inf


def minutes(value):
    if not value:
        return None
    try:
        h, m = map(int, str(value)[:5].split(':'))
        return h * 60 + m if 0 <= h < 24 and 0 <= m < 60 else None
    except (ValueError, TypeError):
        return None


def score(order, distance, duration, start, appointments, windows, service, priorities):
    clock = float(start)
    travel = metres = late = priority_delay = 0.0
    previous = 0
    for index, node in enumerate(order):
        seconds = edge(duration, previous, node)
        metres += edge(distance, previous, node)
        travel += seconds
        clock += seconds / 60
        begin, end = windows.get(node, (None, None))
        exact = appointments.get(node)
        if begin is not None:
            clock = max(clock, begin)
        if exact is not None:
            late += max(0, clock - exact)
            clock = max(clock, exact)
        elif end is not None:
            late += max(0, clock - end)
        priority_delay += index * {'urgent': 120, 'high': 40, 'low': -5}.get(priorities.get(node), 0)
        clock += service
        previous = node
    # Late appointments dominate, then travel time. Distance resolves near ties.
    return late * 3600 + travel + priority_delay + metres / 1000


def exact_open_order(distance, duration, priorities):
    """Held–Karp for up to twelve stops, with an open end and directed streets."""
    count=len(distance)-1
    states={(1 << (i-1),i):(edge(duration,0,i)+edge(distance,0,i)/1000,(i,)) for i in range(1,count+1)}
    for mask in range(1,1 << count):
        for last in range(1,count+1):
            current=states.get((mask,last))
            if current is None:continue
            for node in range(1,count+1):
                flag=1 << (node-1)
                if mask & flag:continue
                penalty=mask.bit_count()*{'urgent':120,'high':40,'low':-5}.get(priorities.get(node),0)
                value=current[0]+edge(duration,last,node)+edge(distance,last,node)/1000+penalty
                key=(mask | flag,node)
                if key not in states or value<states[key][0]:states[key]=(value,current[1]+(node,))
    full=(1 << count)-1
    return list(min((value for (mask,_),value in states.items() if mask==full),key=lambda item:item[0])[1])


def optimize(distance, duration, priorities=None, exact_times=None, start_minute=None,
             windows=None, service_minutes=10, mode='best'):
    n = len(distance)
    if n < 2:
        return [], []
    if n > 101 or len(duration) != n or any(len(row) != n for row in distance + duration):
        raise ValueError('Planeje até 100 PEVs por rota, com matriz de vias válida.')
    priorities = priorities or {}
    appointments = {i: minutes(t) for i, t in (exact_times or {}).items() if minutes(t) is not None}
    windows = {i: (minutes(pair[0]), minutes(pair[1])) for i, pair in (windows or {}).items()}
    start = start_minute if start_minute is not None else 8 * 60
    service = max(0, min(float(service_minutes), 120))
    cost = lambda order: score(order, distance, duration, start, appointments, windows, service, priorities)
    starts = sorted(range(1, n), key=lambda node: edge(duration, 0, node))
    seeds = starts[:1] if mode == 'nearest' else starts[:min(8, n - 1)]
    candidates = []
    for first in seeds:
        order = [first]
        remaining = set(starts) - {first}
        while remaining:
            nxt = min(remaining, key=lambda node: cost(order + [node]))
            order.append(nxt)
            remaining.remove(nxt)
        candidates.append(order)
    if appointments:
        candidates.append(sorted(starts, key=lambda i: appointments.get(i, 10**6)))
    if n<=13 and not appointments and not any(a is not None or b is not None for a,b in windows.values()) and mode!='nearest':
        candidates.append(exact_open_order(distance,duration,priorities))
    best = min(candidates, key=cost)
    best_cost = cost(best)
    if mode != 'nearest':
        # Bounded improvement, including end relocations missed by a greedy tour.
        for _ in range(8):
            improved = best
            improved_cost = best_cost
            for i in range(len(best)):
                for j in range(i + 1, len(best)):
                    options = [best[:i] + best[i:j+1][::-1] + best[j+1:]]
                    moved = best[:i] + best[i+1:]
                    options.append(moved[:j] + [best[i]] + moved[j:])
                    swapped = best[:]
                    swapped[i], swapped[j] = swapped[j], swapped[i]
                    options.append(swapped)
                    for candidate in options:
                        value = cost(candidate)
                        if value + .01 < improved_cost:
                            improved, improved_cost = candidate, value
            if improved_cost >= best_cost:
                break
            best, best_cost = improved, improved_cost
    if not math.isfinite(best_cost):
        raise ValueError('Há PEVs sem trajeto por vias entre si. Confirme as coordenadas antes de criar a rota.')
    warnings = []
    clock, previous = float(start), 0
    for node in best:
        clock += edge(duration, previous, node) / 60
        begin, end = windows.get(node, (None, None))
        if begin is not None:
            clock = max(clock, begin)
        deadline = appointments.get(node, end)
        if deadline is not None and clock > deadline + 2:
            warnings.append(f'Parada {node}: chegada estimada às {int(clock)//60:02d}:{int(clock)%60:02d}, após o horário solicitado.')
        clock = max(clock, appointments.get(node, clock)) + service
        previous = node
    return best, warnings
