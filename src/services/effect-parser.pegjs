/*
 * Peggy Grammar for Daggerheart Effects (v9 - Syntax Fix)
 * This version corrects a syntax error in the PrimaryStatTarget rule.
 */

// Main entry point: Parses one or more comma-separated modifications
Effects
  = first:Modification __ "," __ rest:Effects { return [first, ...rest]; }
  / mod:Modification { return [mod]; }

// A single modification, e.g., "Evasion + 1 when HP < 10"
Modification
  = target:Target __ action:Action __ value:Value condition:Condition? {
      return {
        target: target.key,
        targetScope: target.scope,
        type: action,
        value: value,
        condition: condition || null
      };
    }

// #############################################################################
// ## TARGETS
// #############################################################################

Target
  = ItemTarget
  / PrimaryStatTarget

PrimaryStatTarget
  // Resources (CalculatedStat)
  = "HP Max" / "Max HP" { return { key: "hitPoints.max", scope: "character" }; }
  / "Stress Max" / "Max Stress" { return { key: "stress.max", scope: "character" }; }
  / "Hope Max" / "Max Hope" { return { key: "hope.max", scope: "character" }; }
  // MODIFICATION: "Armor Score" is now the primary, user-facing term.
  / "Armor Score" { return { key: "armorSlots.max", scope: "character" }; }
  / "Armor Slots Max"  { return { key: "armorSlots.max", scope: "character" }; }
  / "Max Armor Slots"  { return { key: "armorSlots.max", scope: "character" }; }
  // Resources (Current Value)
  / "HP" / "Hit Points" { return { key: "hitPoints.current", scope: "character" }; }
  / "Stress" { return { key: "stress.current", scope: "character" }; }
  / "Hope" { return { key: "hope.current", scope: "character" }; }
  / "Armor Slots" { return { key: "armorSlots.current", scope: "character" }; }
  // Core Stats (CalculatedStat)
  / "Evasion" { return { key: "evasion", scope: "character" }; }
  / "Major Threshold" { return { key: "damageThresholds.major", scope: "character" }; }
  / "Severe Threshold" { return { key: "damageThresholds.severe", scope: "character" }; }
  // Core Stats (Direct Value)
  / "Proficiency" { return { key: "proficiency", scope: "character" }; }
  / "Agility" { return { key: "traits.Agility", scope: "character" }; }
  / "Strength" { return { key: "traits.Strength", scope: "character" }; }
  / "Finesse" { return { key: "traits.Finesse", scope: "character" }; }
  / "Instinct" { return { key: "traits.Instinct", scope: "character" }; }
  / "Presence" { return { key: "traits.Presence", scope: "character" }; }
  / "Knowledge" { return { key: "traits.Knowledge", scope: "character" }; }
  // ... (other targets)
  / "Unarmed Damage" { return { key: "unarmedDamage.flatBonus", scope: "character" }; } // Default to flat bonus
  / "Unarmed Dice Count" { return { key: "unarmedDamage.numberOfDice", scope: "character" }; }
  // / "Unarmed Base Dice" { return { key: "unarmedDamage.baseDice", scope: "character" }; }
  // Gold (Direct Value)
  / "Gold Handfuls" { return { key: "gold.handfuls", scope: "character" }; }
  / "Gold Bags" { return { key: "gold.bags", scope: "character" }; }
  / "Gold Chests" { return { key: "gold.chests", scope: "character" }; }

ItemTarget
  = scope:("Any Weapon" / "Any Armor" / "Equipped Weapon" / "Equipped Armor" / "Weapon" / "Armor") __ filter:ItemFilter? __ ":" __ property:ItemProperty {
      return {
        key: property,
        scope: { scopeType: scope.replace(" ", ""), filter: filter || null }
      };
    }

ItemFilter
  = "with trait" __ trait:QuotedString { return { type: 'byTrait', value: trait }; }
  / name:QuotedString { return { type: 'byName', value: name }; }

ItemProperty
  = "Damage" { return "damageComponents.flatBonus"; } // Targets the flat modifier
  / "Dice Count" { return "damageComponents.numberOfDice"; } // NEW: Targets the number of dice bonus
  / "Dice Type" { return "damageComponents.baseDice"; }     // NEW: Targets the die type (e.g., d6, d8)
  / "Damage Type" { return "damageComponents.damageType"; }  // NEW: Targets the damage type (e.g., phy, mag)
  / "Base Score" { return "baseScore"; }
  / "Major Threshold" { return "baseThresholds.major"; }
  / "Severe Threshold" { return "baseThresholds.severe"; }

// #############################################################################
// ## ACTIONS
// #############################################################################

Action
  = "+" / "add" / "increase by" { return "bonus"; }
  / "-" / "subtract" / "reduce by" { return "penalty"; }
  / "=" / "set to" / "override with" { return "override"; }

// #############################################################################
// ## VALUES & CONDITIONS
// #############################################################################

Value
  = DiceFormula / KeywordValue / Number / QuotedString
Number
  = digits:[0-9]+ { return parseInt(digits.join(""), 10); }
DiceFormula
  = formula:$([0-9]* "d" [0-9]+ ([+-] [0-9]+)?) { return formula; }
QuotedString
  = '"' chars:[^"]* '"' { return chars.join(""); }
KeywordValue
  = "PROFICIENCY" { return { type: 'keyword', value: 'PROFICIENCY' }; }
  / "LEVEL" { return { type: 'keyword', value: 'LEVEL' }; }
  / "STRENGTH" { return { type: 'keyword', value: 'STRENGTH' }; }
  / "AGILITY" { return { type: 'keyword', value: 'AGILITY' }; }
  / "FINESSE" { return { type: 'keyword', value: 'FINESSE' }; }
  / "INSTINCT" { return { type: 'keyword', value: 'INSTINCT' }; }
  / "PRESENCE" { return { type: 'keyword', value: 'PRESENCE' }; }
  / "KNOWLEDGE" { return { type: 'keyword', value: 'KNOWLEDGE' }; }
Condition
  = __ ("when" / "if") __ target:ConditionTarget __ op:Operator __ value:Value {
      return { target: target, operator: op, value: value };
    }
ConditionTarget
  = "HP" { return "hitPoints.current"; }
  / "Max HP" { return "hitPoints.max.final"; }
  / "Stress" { return "stress.current"; }
  / "Hope" { return "hope.current"; }
  / "Equipped Weapon Count" { return "equippedWeaponIds.length"; }
  / "Has Condition" { return "conditions"; }
Operator
  = "=" { return "equals"; } / "!=" { return "notEquals"; } / ">=" { return "greaterThanOrEqual"; } / "<=" { return "lessThanOrEqual"; } / ">" { return "greaterThan"; } / "<" { return "lessThan"; } / "is not" { return "isNot"; } / "is" { return "is"; }

// ## WHITESPACE
__ = [ \t\n\r]*