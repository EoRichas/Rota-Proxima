import sys
import types


def install_optional_dependency_stubs():
    try:
        import requests  # noqa: F401
        import reportlab  # noqa: F401
        return
    except ModuleNotFoundError:
        pass

    class DummySession:
        def mount(self, *_args, **_kwargs):
            return None

    class Dummy:
        def __init__(self, *_args, **_kwargs):
            pass

    requests = types.ModuleType('requests')
    requests.Session = DummySession

    class RequestException(Exception):
        pass

    class Timeout(RequestException):
        pass

    class ConnectionError(RequestException):
        pass

    requests.RequestException = RequestException
    requests.Timeout = Timeout
    requests.ConnectionError = ConnectionError
    adapters = types.ModuleType('requests.adapters')
    adapters.HTTPAdapter = Dummy
    sys.modules['requests'] = requests
    sys.modules['requests.adapters'] = adapters

    reportlab = types.ModuleType('reportlab')
    reportlab_lib = types.ModuleType('reportlab.lib')
    colors = types.ModuleType('reportlab.lib.colors')
    colors.HexColor = lambda value: value
    colors.white = 'white'
    pagesizes = types.ModuleType('reportlab.lib.pagesizes')
    pagesizes.A4 = (595, 842)
    styles = types.ModuleType('reportlab.lib.styles')
    styles.getSampleStyleSheet = lambda: {}
    styles.ParagraphStyle = Dummy
    enums = types.ModuleType('reportlab.lib.enums')
    enums.TA_CENTER = 'CENTER'
    platypus = types.ModuleType('reportlab.platypus')
    for name in ('SimpleDocTemplate', 'Paragraph', 'Spacer', 'LongTable', 'TableStyle', 'Table', 'Image'):
        setattr(platypus, name, Dummy)
    sys.modules.update({
        'reportlab': reportlab,
        'reportlab.lib': reportlab_lib,
        'reportlab.lib.colors': colors,
        'reportlab.lib.pagesizes': pagesizes,
        'reportlab.lib.styles': styles,
        'reportlab.lib.enums': enums,
        'reportlab.platypus': platypus,
    })
