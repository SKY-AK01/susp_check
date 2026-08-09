"""
Import all models here so alembic/env.py sees them via Base.metadata.
"""
from app.database import Base  # noqa: F401

from .project import Project, LabelSchema, Label, LabelAttribute  # noqa: F401
from .upload import Upload  # noqa: F401
from .student import Student  # noqa: F401
from .image import Image, Shape, ShapeAttribute, Tag  # noqa: F401
from .comparison import ReferenceSet, ComparisonRun, ComparisonResult, ShapeDiff  # noqa: F401
from .feedback import Feedback, ParseWarning, JobRun, AuditLog  # noqa: F401
from .user import User  # noqa: F401
