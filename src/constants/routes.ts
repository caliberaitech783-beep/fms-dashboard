import {
  AlertTriangle,
  BarChart3,
  Bell,
  BellDot,
  ClipboardList,
  Database,
  Fuel,
  Gauge,
  Megaphone,
  MessageCircle,
  Settings,
  Truck,
  UserCog,
} from "lucide-react";

export const NAV_GROUPS = [
  { id: "operate", label: "Operate" },
  { id: "analyze", label: "Analyze" },
  { id: "control", label: "Control" },
  { id: "admin", label: "Admin" },
] as const;

export type NavGroupId = (typeof NAV_GROUPS)[number]["id"];

export const NAV_ITEMS = [
  { id: "management", label: "Management Dashboard", icon: BarChart3, group: "operate" },
  { id: "fleet", label: "Fleet", icon: Truck, group: "operate" },
  { id: "fuel", label: "Fuel", icon: Fuel, group: "operate" },
  { id: "production", label: "Production", icon: Gauge, group: "operate" },
  { id: "diesel", label: "Diesel Analysis", icon: Fuel, group: "analyze" },
  { id: "alerts", label: "Alerts", icon: AlertTriangle, group: "analyze" },
  { id: "reports", label: "Reports", icon: ClipboardList, group: "analyze" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "control" },
  { id: "admin-notifications", label: "Admin Notifications", icon: Megaphone, group: "control" },
  { id: "whatsapp", label: "WhatsApp Delivery", icon: MessageCircle, group: "control" },
  { id: "integrations", label: "Integrations", icon: Database, group: "admin" },
  { id: "master-data", label: "Master Data", icon: BellDot, group: "admin" },
  { id: "users", label: "Users", icon: UserCog, group: "admin" },
  { id: "settings", label: "Settings", icon: Settings, group: "admin" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
export type NavItemId = (typeof NAV_ITEMS)[number]["id"];
